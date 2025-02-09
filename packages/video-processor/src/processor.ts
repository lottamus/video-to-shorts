import { EventEmitter } from "node:events";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs-extra";
import type { z } from "zod";
import type { FrameAnalysis } from "./analyzer";
import { Analyzer } from "./analyzer";
import { type AnalyzerConfig, analyzerConfigSchema } from "./criteria";
import { DEFAULT_CRITERIA } from "./criteria";
import type { DebugEvent, ProcessingEvent } from "./types";

export interface VideoProcessorConfig {
  analyzerConfig?: AnalyzerConfig;
  frameInterval: number;
  parallelFrames: number;
  outputDir: string;
  tempDir: string;
  startTime?: string; // Optional start time in format HH:MM:SS or MM:SS
  endTime?: string; // Optional end time in format HH:MM:SS or MM:SS
}

const MAXIMUM_VIDEO_HEIGHT = 1920; // 1080;

export class VideoProcessor extends EventEmitter {
  public readonly analyzer?: Analyzer;
  private config: VideoProcessorConfig;

  constructor(config: VideoProcessorConfig) {
    super();
    this.config = config;

    if (config.analyzerConfig) {
      // Validate analyzer config
      const result = analyzerConfigSchema.safeParse(config.analyzerConfig);
      if (!result.success) {
        const { error } = result;
        throw new Error(
          `Invalid analyzer config: ${error.errors.map((err: z.ZodIssue) => `${err.path.join(".")}: ${err.message}`).join(", ")}`
        );
      }
      this.analyzer = new Analyzer(result.data);

      // Re-emit analyzer events as analyzing events
      this.analyzer.on("analyzer", (event) => {
        this.emit("analyzing", event);
      });
    }
  }

  async processVideo(videoPath: string): Promise<string> {
    // Extract start and end times from filename if filename is in the format "00:00:00-00:00:00.mp4"
    const startEndMatch = path
      .basename(videoPath)
      .match(/((\d{2}:\d{2}:\d{2})-(\d{2}:\d{2}:\d{2}))\.mp4/);
    const startTime = startEndMatch?.[2] || this.config.startTime;
    const endTime = startEndMatch?.[3] || this.config.endTime;

    const videoFilename = path
      .basename(videoPath, path.extname(videoPath))
      // Remove the start and end times from the video name
      .replace(startEndMatch?.[1] || "", "")
      // Remove "-" from start and end of video name
      .replace(/^-|-$/g, "");

    // Use cleaned filename if present, otherwise use the directory name
    const videoName = videoFilename || path.basename(path.dirname(videoPath));
    const tempFramesDir = path.join(this.config.tempDir, videoName);
    const outputPath = path.join(this.config.outputDir, `${videoName}.mp4`);

    this.emit<ProcessingEvent>("processing", {
      stage: "init",
      message: `Processing video: ${videoPath}`,
    });

    this.emit<ProcessingEvent>("processing", {
      stage: "creating_directories",
      message: "Creating directories...",
      data: [tempFramesDir, this.config.outputDir],
    });
    await fs.ensureDir(tempFramesDir);
    await fs.ensureDir(this.config.outputDir);

    let actions = new Map<number, FrameAnalysis>();
    if (this.analyzer) {
      this.emit<ProcessingEvent>("processing", {
        stage: "extracting_frames",
        message: "Extracting frames...",
      } as ProcessingEvent);
      await this.extractFrames(videoPath, tempFramesDir);

      this.emit<ProcessingEvent>("processing", {
        stage: "analyzing_frames",
        message: "Analyzing frames...",
      });
      actions = await this.analyzeFrames(tempFramesDir);
    }

    this.emit<ProcessingEvent>("processing", {
      stage: "applying_modifications",
      message: "Applying video modifications...",
    });
    await this.applyActions({
      inputPath: videoPath,
      outputPath,
      actions,
      startTime,
      endTime,
    });

    this.emit<ProcessingEvent>("processing", {
      stage: "cleanup",
      message: "Cleaning up temporary files...",
    });
    await fs.remove(tempFramesDir);

    this.emit<ProcessingEvent>("processing", {
      stage: "complete",
      message: `Processing complete! Output saved to: ${outputPath}`,
      data: { outputPath },
    });

    return outputPath;
  }

  private extractFrames(videoPath: string, outputDir: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const filterOptions = [];

      // Add fps filter
      filterOptions.push(`fps=1/${this.config.frameInterval}`);

      // Escape the output path for frame pattern
      const outputPattern = path
        .join(outputDir, "frame-%d.jpg")
        .replace(/\\/g, "/");

      ffmpeg(videoPath)
        .outputOptions([
          "-y", // Overwrite output files if they exist
          "-qscale:v",
          "2", // JPEG quality scale (2-31, 2 being highest quality)
          "-qmin",
          "2",
          "-qmax",
          "2",
          "-strict",
          "unofficial", // Allow non-standard YUV range
        ])
        .output(outputPattern)
        .on("start", (commandLine) => {
          this.emit<DebugEvent>("debug", {
            type: "debug",
            message: "Executing command:",
            data: commandLine,
          });
        })
        .on("error", (err, _stdout, stderr) => {
          this.emit<DebugEvent>("debug", {
            type: "error",
            message: "FFmpeg stderr:",
            data: stderr,
          });
          reject(err);
        })
        .on("end", () => resolve())
        .run();
    });
  }

  private async analyzeFrames(
    framesDir: string
  ): Promise<Map<number, FrameAnalysis>> {
    if (!this.analyzer) {
      return new Map<number, FrameAnalysis>();
    }

    const actions = new Map<number, FrameAnalysis>();
    const frames = await fs.readdir(framesDir);
    let processedFrames = 0;

    for (let i = 0; i < frames.length; i += this.config.parallelFrames) {
      const batch = frames.slice(i, i + this.config.parallelFrames);
      const batchPromises = batch.map(async (frame) => {
        const frameNumber = Number.parseInt(
          frame.match(/frame-(\d+)\.jpg/)?.[1] ?? "0",
          10
        );
        const frameData = await fs.readFile(
          path.join(framesDir, frame),
          "base64"
        );
        const analysis = await this.analyzer!.analyzeFrame(frameData);
        actions.set(frameNumber * this.config.frameInterval, analysis);

        processedFrames += 1;
        const progress = (processedFrames / frames.length) * 100;

        this.emit<ProcessingEvent>("processing", {
          stage: "analyzing_frames",
          message: `Analyzing frames: ${progress.toFixed(1)}% (${processedFrames}/${frames.length})`,
          data: {
            progress: {
              current: processedFrames,
              total: frames.length,
              percentage: progress,
            },
          },
        });
      });

      await Promise.all(batchPromises);
    }

    return actions;
  }

  private timeToSeconds(time: string): number {
    const parts = time.split(":").map(Number).reverse();
    let seconds = 0;
    for (let i = 0; i < parts.length; i++) {
      seconds += parts[i] * 60 ** i;
    }
    return seconds;
  }

  private applyActions({
    inputPath,
    outputPath,
    actions,
    startTime,
    endTime,
  }: {
    inputPath: string;
    outputPath: string;
    actions: Map<number, FrameAnalysis>;
    startTime?: string;
    endTime?: string;
  }): Promise<void> {
    let duration: number | null = null;
    let currentSegment = 0;
    const confidenceThreshold =
      this.config.analyzerConfig?.confidenceThreshold ??
      DEFAULT_CRITERIA.confidenceThreshold;

    // Frame height should be no larger than the maximum video height
    const frameHeight = `min(round(ih/0.85)\\,${MAXIMUM_VIDEO_HEIGHT})`;
    // Frame width should be 9:16 aspect ratio
    const frameWidth = `round(${frameHeight}*(9/16))`;
    // Reduce content height by 15% to fit comfortably within the frame
    const contentHeight = `${frameHeight}*0.85`;
    // Black bars should be equal on both sides
    const blackBars = `round((${frameHeight}-${contentHeight})/2)`;

    let filterComplex = [
      // Scale content height to fit within the frame
      `scale=-2:${contentHeight}`,
      // Crop to 9:16 aspect ratio
      `crop=${frameWidth}:${contentHeight}:(iw-${frameWidth})/2:0`,
      // Pad back to full height with black bars
      `pad=${frameWidth}:${frameHeight}:0:${blackBars}:black`,
    ].join(",");

    const frameNumbers = Array.from(actions.keys()).sort((a, b) => a - b);

    for (let i = 0; i < frameNumbers.length; i += 1) {
      const frameNumber = frameNumbers[i];
      const nextFrameNumber = frameNumbers[i + 1] ?? Number.POSITIVE_INFINITY;
      const action = actions.get(frameNumber);

      if (!action || action.action === "remove") {
        continue;
      }

      if (action.confidence < confidenceThreshold) {
        this.emit<ProcessingEvent>("processing", {
          stage: "applying_modifications",
          message: `Skipping frame ${frameNumber} (${action.action}) due to low confidence: ${action.confidence.toFixed(2)}`,
          data: {
            frame: {
              number: frameNumber,
              action: action.action,
              confidence: action.confidence,
            },
          },
        });
        continue;
      }

      const baseFilter =
        action.action === "speed_up" ? "setpts=0.5*PTS" : "copy";

      filterComplex += `[0:v]trim=start=${frameNumber / 30}:end=${
        nextFrameNumber / 30
      },${baseFilter},${filterComplex}[v${currentSegment}];`;
      currentSegment += 1;
    }

    let command = ffmpeg(inputPath).output(outputPath);

    if (startTime) {
      command = command.setStartTime(startTime);
    }

    if (endTime) {
      duration =
        this.timeToSeconds(endTime) -
        this.timeToSeconds(startTime || "00:00:00");
      command = command.setDuration(duration);
    }

    if (currentSegment > 0) {
      const concatInputs = Array.from(
        { length: currentSegment },
        (_, i) => `[v${i}]`
      ).join("");
      command = command
        .complexFilter(`${concatInputs}concat=n=${currentSegment}:v=1[outv]`)
        .map("[outv]");
    } else {
      this.emit<ProcessingEvent>("processing", {
        stage: "applying_modifications",
        message:
          "No segments met the confidence threshold. Copying original video.",
      });

      command = command.complexFilter(`[0:v]${filterComplex}`);
    }

    return new Promise((resolve, reject) => {
      command
        .on("start", (commandLine) => {
          this.emit<DebugEvent>("debug", {
            type: "debug",
            message: "Executing command:",
            data: commandLine,
          });
        })
        .on("codecData", (codecData) => {
          duration = duration || Number(codecData.duration);
        })
        .on("progress", (progress) => {
          if (!progress.percent) {
            return;
          }

          let percent = progress.percent;
          const currentTime = progress.timemark
            ? this.timeToSeconds(progress.timemark)
            : 0;

          if (duration) {
            percent = (currentTime / duration) * 100;
          }

          this.emit<ProcessingEvent>("processing", {
            stage: "applying_modifications",
            message: `Compiling video (${Math.round(percent)}%)`,
            data: {
              progress: {
                current: currentTime,
                total: duration,
                percentage: percent,
              },
            },
          });
        })
        .on("end", () => resolve())
        .on("error", reject)
        .run();
    });
  }
}
