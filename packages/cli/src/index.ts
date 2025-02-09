#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import type {
  AnalyzerConfig,
  AnalyzerEvent,
  DebugEvent,
  ProcessingEvent,
} from "@shipworthy/video-processor";
import { VideoProcessor } from "@shipworthy/video-processor";
import { Command } from "commander";
import fs from "fs-extra";
import { version } from "../package.json";
import { defaultConfig } from "./config";
import { ensureFFmpeg } from "./ffmpeg";
import { createLogger, logger } from "./logger";

function handleProcessingEvent(event: ProcessingEvent) {
  switch (event.stage) {
    case "init":
      logger.info(`\n${event.message}`);
      if (event.data) {
        logger.debug(event.data);
      }
      logger.debug("");
      break;
    case "analyzing_frames":
      if (event.data?.progress) {
        process.stdout.write(`\r${event.message}`);
      } else {
        logger.info(event.message);
      }
      if (event.data && !event.data.progress) {
        logger.debug("Frame Analysis Data:", event.data);
      }
      logger.debug("");
      break;
    case "applying_modifications":
      if (event.data?.progress) {
        process.stdout.write(`\r${event.message}`);
      } else {
        logger.info(event.message);
      }

      if (event.data && !event.data.progress) {
        logger.debug("Modification Data:", event.data);
      }
      logger.debug("");
      break;
    case "cleanup":
      logger.info(`\n${event.message}`);
      if (event.data) {
        logger.debug("Cleanup Data:", event.data);
      }
      logger.debug("");
      break;
    case "complete":
      logger.info(`\n${event.message}`);
      if (event.data) {
        logger.debug("Completion Data:", event.data);
      }
      logger.debug("");
      break;
    default:
      logger.info(event.message);
      if (event.data) {
        logger.debug(event.data);
      }
      logger.debug("");
  }
}

function handleAnalyzerEvent(event: AnalyzerEvent) {
  switch (event.type) {
    case "warning":
      logger.warn(event.message);
      if (event.data) {
        logger.debug("Warning Data:", event.data);
      }
      break;
    case "error":
      logger.error(event.message, event.data);
      if (event.data) {
        logger.error("Error Data:", event.data);
      }
      break;
  }
}

function handleDebugEvent(event: DebugEvent) {
  switch (event.type) {
    case "debug": {
      logger.debug(event.message);
      logger.debug(
        typeof event.data === "object"
          ? `${JSON.stringify(event.data, null, 2)}`
          : event.data || ""
      );
      logger.debug("");
      break;
    }
    case "error": {
      logger.error(event.message);
      logger.debug(
        typeof event.data === "object"
          ? `${JSON.stringify(event.data, null, 2)}`
          : event.data || ""
      );
      logger.debug("");
      break;
    }
  }
}

async function parseAnalyzerConfig(
  input: string
): Promise<Partial<AnalyzerConfig>> {
  try {
    // First try to parse as JSON string
    return JSON.parse(input);
  } catch {
    try {
      // If that fails, try to read as file path
      const content = await fs.readFile(input, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to parse analyzer config. Input must be a valid JSON string or path to a JSON file. Error: ${message}`,
        {
          cause: error,
        }
      );
    }
  }
}

async function processVideosInParallel(
  videoFiles: string[],
  resolvedInput: string,
  videoProcessor: VideoProcessor,
  maxConcurrent: number
): Promise<void> {
  const inProgress = new Set<string>();
  const queue = [...videoFiles];

  while (queue.length > 0 || inProgress.size > 0) {
    // Fill up to maxConcurrent with new tasks
    while (queue.length > 0 && inProgress.size < maxConcurrent) {
      const video = queue.shift()!;
      const videoPath = path.join(resolvedInput, video);
      inProgress.add(video);

      logger.debug("");
      logger.debug(`Active processes: ${inProgress.size}/${maxConcurrent}`);

      videoProcessor
        .processVideo(videoPath)
        .then(() => {
          inProgress.delete(video);
        })
        .catch((error) => {
          logger.error(`Error processing ${video}:`, error);
          inProgress.delete(video);
        });
    }

    // Wait a bit before checking again
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const program = new Command();

program
  .name("video-to-shorts")
  .description("CLI to process videos into short-form content.")
  .argument("<input>", "Input directory containing videos")
  .option(
    "-c, --config <json|path>",
    "Analyzer config as JSON string or path to JSON file"
  )
  .option("-o, --output <path>", "Output directory")
  .option("-t, --temp <path>", "Temp directory", defaultConfig.tempDir)
  .option(
    "-f, --frame-interval <number>",
    "Analyze one frame every N frames (higher values = faster but less precise)",
    String(defaultConfig.frameInterval)
  )
  .option(
    "-p, --parallel-frames <number>",
    "Number of frames to analyze in parallel within each video",
    String(defaultConfig.parallelFrames)
  )
  .option(
    "-k, --openai-api-key <key>",
    "OpenAI API key",
    defaultConfig.openaiApiKey
  )
  .option("-d, --debug", "Enable debug mode with verbose logging", false)
  .option(
    "-s, --start <time>",
    "Start time of the video (format: HH:MM:SS or MM:SS)"
  )
  .option(
    "-e, --end <time>",
    "End time of the video (format: HH:MM:SS or MM:SS)"
  )
  .option(
    "-j, --jobs <number>",
    "Number of videos to process concurrently (max: number of CPU cores)",
    String(os.cpus().length)
  )
  .version(version, "-v, --version", `v${version}`)
  .helpOption("-h, --help", "Display help for command")
  .action(async (input, options) => {
    createLogger({ debug: options.debug });

    try {
      logger.info(`🎥 Video to Shorts CLI v${version}`);
      const maxConcurrent = Math.max(
        1,
        Math.min(Number(options.jobs), os.cpus().length)
      );
      logger.info(`Processing up to ${maxConcurrent} videos concurrently`);

      // Ensure FFmpeg is installed
      try {
        await ensureFFmpeg();
      } catch (error) {
        if (error instanceof Error) {
          logger.error(error.message);
          process.exit(1);
        }
        throw error;
      }

      // Resolve input path relative to current working directory
      const resolvedInput = path.resolve(process.cwd(), input);

      let analyzerConfig: AnalyzerConfig | undefined;

      // Set default output directory inside input directory if not specified
      const outputDir = options.output
        ? path.resolve(process.cwd(), options.output)
        : path.join(resolvedInput, "video-to-shorts");

      logger.debug("\nPath Resolution:", {
        inputPath: input,
        resolvedInput,
        cwd: process.cwd(),
        absoluteCwd: path.resolve(process.cwd()),
        outputDir,
        exists: fs.existsSync(resolvedInput),
        isDirectory: fs.existsSync(resolvedInput)
          ? fs.statSync(resolvedInput).isDirectory()
          : false,
      });

      if (
        fs.existsSync(resolvedInput) &&
        fs.statSync(resolvedInput).isDirectory()
      ) {
        const dirContents = fs.readdirSync(resolvedInput);
        logger.debug("Directory Contents:", dirContents);
      }

      if (!fs.existsSync(resolvedInput)) {
        throw new Error(`Input directory does not exist: ${resolvedInput}`);
      }

      if (!fs.statSync(resolvedInput).isDirectory()) {
        throw new Error(`Input path is not a directory: ${resolvedInput}`);
      }

      if (options.config || options.openaiApiKey) {
        analyzerConfig = {
          openaiApiKey: options.openaiApiKey,
        };

        if (options.config) {
          const userConfig = await parseAnalyzerConfig(options.config);
          analyzerConfig = {
            ...analyzerConfig,
            ...userConfig,
          };
        }

        logger.debug("\nAnalyzer Config:", {
          ...analyzerConfig,
          openaiApiKey: analyzerConfig.openaiApiKey ? "***" : undefined,
        });
      }

      const videos = await fs.readdir(resolvedInput);
      const videoFiles = videos.filter((file) =>
        [".mp4", ".avi", ".mov"].includes(path.extname(file).toLowerCase())
      );

      // Return if no videos are found
      if (videoFiles.length === 0) {
        logger.info("No videos found in the input directory.");
        process.exit(0);
      }

      logger.debug("\nFound Videos:", {
        directory: resolvedInput,
        totalFiles: videos.length,
        videoFiles: videoFiles,
      });

      const videoProcessor = new VideoProcessor({
        analyzerConfig,
        frameInterval: Number(options.frameInterval),
        parallelFrames: Number(options.parallelFrames),
        outputDir: outputDir,
        tempDir: options.temp,
        startTime: options.start,
        endTime: options.end,
      });

      logger.debug("\nVideo Processor Options:", {
        frameInterval: Number(options.frameInterval),
        parallelFrames: Number(options.parallelFrames),
        outputDir,
        tempDir: options.temp,
        hasAnalyzer: !!videoProcessor.analyzer,
      });

      // Set up event handlers
      videoProcessor.on("processing", (event) => handleProcessingEvent(event));
      videoProcessor.on("analyzing", (event) => handleAnalyzerEvent(event));
      videoProcessor.on("debug", (event) => handleDebugEvent(event));

      await processVideosInParallel(
        videoFiles,
        resolvedInput,
        videoProcessor,
        maxConcurrent
      );
    } catch (error) {
      logger.error(error);
      if (error instanceof Error) {
        logger.debug("Error Stack:", error.stack);
      }
      process.exit(1);
    }
  });

program.parse();
