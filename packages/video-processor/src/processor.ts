import { EventEmitter } from "node:events";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs-extra";
import { Analyzer } from "./analyzer";
import { DEFAULT_CRITERIA } from "./criteria";
import type {
  FrameAnalysis,
  VideoProcessorConfig,
  VideoProcessorEventMap,
} from "./types";

const MAXIMUM_VIDEO_HEIGHT = 1920; // 1080;

export class VideoProcessor extends EventEmitter<VideoProcessorEventMap> {
  public readonly analyzer?: Analyzer;
  private config: VideoProcessorConfig;

  constructor(config: VideoProcessorConfig) {
    super();
    this.config = config;

    if (config.analyzerConfig) {
      this.analyzer = new Analyzer(config.analyzerConfig);

      // Re-emit analyzer events as analyzing events
      this.analyzer.on("debug", (event) => {
        this.emit("debug", event);
      });
      this.analyzer.on("error", (event) => {
        this.emit("error", event);
      });
    }
  }

  async processVideo(videoPath: string): Promise<string> {
    const processStart = Date.now();
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

    this.emit("processing", {
      stage: "init",
      message: "Processing video",
      data: {
        videoPath,
      },
    });

    this.emit("processing", {
      stage: "creating_directories",
      message: "Creating directories...",
      data: [tempFramesDir, this.config.outputDir],
    });
    await fs.ensureDir(tempFramesDir);
    await fs.ensureDir(this.config.outputDir);

    let actions = new Map<number, FrameAnalysis>();
    if (this.analyzer) {
      this.emit("processing", {
        stage: "extracting_frames",
        message: "Extracting frames...",
      });
      await this.extractFrames(videoPath, tempFramesDir);

      this.emit("processing", {
        stage: "analyzing_frames",
        message: "Analyzing frames...",
      });
      actions = await this.analyzeFrames(tempFramesDir);
    }

    this.emit("processing", {
      stage: "applying_modifications",
      message: "Applying modifications...",
    });
    await this.applyActions({
      inputPath: videoPath,
      outputPath,
      actions,
      startTime,
      endTime,
    });

    this.emit("processing", {
      stage: "cleanup",
      message: "Cleaning up temporary files...",
    });
    await fs.remove(tempFramesDir);

    this.emit("processing", {
      stage: "complete",
      message: `Processing complete! Output saved to: ${outputPath}`,
      data: { outputPath, timeElapsed: Date.now() - processStart },
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
          this.emit("debug", {
            type: "command",
            message: "Executing command:",
            data: commandLine,
          });
        })
        .on("error", (err, _stdout, stderr) => {
          this.emit("error", {
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
        const analysis = await this.analyzer!.analyzeFrame(
          frameData,
          frameNumber
        );
        actions.set(frameNumber * this.config.frameInterval, analysis);

        processedFrames += 1;
        const progress = (processedFrames / frames.length) * 100;

        this.emit("processing", {
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
        this.emit("processing", {
          stage: "applying_modifications",
          message: `Skipping frame ${frameNumber} (${action.action}) due to low confidence: ${action.confidence.toFixed(2)}`,
          data: {
            frame: frameNumber,
            action: action.action,
            confidence: action.confidence,
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
      this.emit("processing", {
        stage: "applying_modifications",
        message:
          "No segments met the confidence threshold. Copying original video.",
      });

      command = command.complexFilter(`[0:v]${filterComplex}`);
    }

    this.emit("processing", {
      stage: "compiling_video",
      message: "Compiling video...",
    });

    return new Promise((resolve, reject) => {
      command
        .on("start", (commandLine) => {
          this.emit("debug", {
            type: "command",
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

          this.emit("processing", {
            stage: "compiling_video",
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
