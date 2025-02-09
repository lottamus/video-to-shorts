#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { program } from "@commander-js/extra-typings";
import type {
  AnalyzerConfig,
  DebugEvent,
  ProcessingEvent,
} from "@shipworthy/video-processor";
import { VideoProcessor } from "@shipworthy/video-processor";

import fs from "fs-extra";
import { bold, green, underline } from "yoctocolors";

import type { ErrorEvent } from "../../video-processor/src/types";
import { version } from "../package.json";
import { defaultConfig } from "./config";
import { ensureFFmpeg } from "./ffmpeg";
import { createLogger, logger } from "./logger";

function handleProcessingEvent(event: ProcessingEvent) {
  switch (event.stage) {
    case "init":
      logger.info("Processing video:", underline(event.data.videoPath));
      logger.info("");
      break;
    case "creating_directories":
      logger.info(event.message);
      logger.debug(event.data.map((dir) => `- ${underline(dir)}`).join("\n"));
      logger.info("");
      break;
    case "extracting_frames":
      logger.info(event.message);
      logger.debug(event.data);
      logger.info("");
      break;
    case "analyzing_frames":
      logger.info(event.message);
      if (event.data) {
        logger.debug("Frame Analysis Data:", event.data);
      }
      logger.info("");
      break;
    case "applying_modifications":
      logger.info(event.message);
      if (event.data) {
        logger.debug("Modification Data:", event.data);
      }
      logger.info("");
      break;
    case "compiling_video":
      logger.info(event.message);
      if (!event.data) {
        logger.info("");
      }
      break;
    case "cleanup":
      logger.info("");
      logger.info(event.message);
      logger.info("");
      break;
    case "complete":
      logger.info(green("✔ Processing complete!"));
      logger.info("");
      if (event.data.outputPath) {
        logger.info("Video output saved to", underline(event.data.outputPath));
      }
      logger.info("");
      break;
  }
}

function handleErrorEvent(event: ErrorEvent) {
  switch (event.type) {
    case "error": {
      logger.error(event.message);
      logger.debug(
        typeof event.data === "object"
          ? `${JSON.stringify(event.data, null, 2)}`
          : event.data || ""
      );
      logger.info("\n");
      break;
    }
  }
}

function handleDebugEvent(event: DebugEvent) {
  switch (event.type) {
    case "command": {
      logger.debug("Executing command:");
      logger.debug(bold(event.data));
      logger.debug("");
      break;
    }
    case "debug": {
      logger.debug(event.message);
      logger.debug(
        typeof event.data === "object"
          ? `${JSON.stringify(event.data, null, 2)}`
          : event.data || ""
      );
      logger.debug("\n");
      break;
    }
  }
}

async function parseAnalyzerConfig(
  input: string
): Promise<Partial<AnalyzerConfig>> {
  let contents = input;

  // First check if input is a file
  if (fs.existsSync(input)) {
    contents = await fs.readFile(input, "utf-8");
  }

  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(
      "Failed to parse analyzer config. Input must be a valid JSON string or path to a JSON file.",
      {
        cause: error,
      }
    );
  }
}

async function processVideosInParallel(
  videoFiles: string[],
  resolvedInput: string,
  videoProcessor: VideoProcessor,
  jobs: number
): Promise<void> {
  const maxConcurrent = Math.max(1, Math.min(jobs, os.cpus().length));
  logger.debug(
    `Processing up to ${bold(String(`${Math.min(videoFiles.length, maxConcurrent)} videos`))} concurrently`,
    "\n"
  );

  const inProgress = new Set<string>();
  const queue = [...videoFiles];

  while (queue.length > 0 || inProgress.size > 0) {
    // Fill up to maxConcurrent with new tasks
    while (queue.length > 0 && inProgress.size < maxConcurrent) {
      const video = queue.shift()!;
      const videoPath = path.join(resolvedInput, video);
      inProgress.add(video);

      logger.debug(
        `Active processes: ${bold(`${inProgress.size}/${maxConcurrent}`)}\n`
      );

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

async function resolveVideoFiles(input: string, output?: string) {
  const resolvedInput = path.resolve(process.cwd(), input);
  if (!fs.existsSync(resolvedInput)) {
    throw new Error(`Input path does not exist: ${resolvedInput}`);
  }
  const resolvedInputIsDirectory = fs.statSync(resolvedInput).isDirectory();

  // Set default output directory inside input directory if not specified
  const outputDir = output
    ? path.resolve(process.cwd(), output)
    : resolvedInputIsDirectory
      ? path.join(resolvedInput, "video-to-shorts")
      : path.join(
          path.basename(resolvedInput, path.extname(resolvedInput)),
          "video-to-shorts"
        );

  const videoFiles: string[] = [];

  if (resolvedInputIsDirectory) {
    const dirContents = await fs.readdir(resolvedInput);
    videoFiles.push(
      ...dirContents.filter((file) =>
        [".mp4", ".avi", ".mov"].includes(path.extname(file).toLowerCase())
      )
    );
  } else {
    videoFiles.push(resolvedInput);
  }

  return {
    input: resolvedInput,
    output: outputDir,
    videos: videoFiles,
  };
}

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

    logger.info(bold(`🎥 Video to Shorts CLI v${version}`), "\n");

    const {
      input: resolvedInput,
      output: outputDir,
      videos,
    } = await resolveVideoFiles(input, options.output);

    logger.debug("Paths:");
    logger.debug(`- Working Directory: ${underline(process.cwd())}`);
    logger.debug(
      `- Input ${
        fs.existsSync(resolvedInput)
          ? fs.statSync(resolvedInput).isDirectory()
            ? "Directory"
            : "File"
          : "Unknown"
      }: ${underline(resolvedInput)}`
    );
    logger.debug(`- Output Directory: ${underline(outputDir)}`);
    logger.debug("");

    // Return if no videos are found
    if (videos.length === 0) {
      logger.info("No videos found.");
      process.exit(0);
    }

    logger.debug("Videos:");
    logger.debug(videos.map((file) => `- ${underline(file)}`).join("\n"));
    logger.debug("");

    let analyzerConfig: AnalyzerConfig | undefined;
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

    // Ensure FFmpeg is installed
    await ensureFFmpeg();

    const videoProcessor = new VideoProcessor({
      analyzerConfig,
      frameInterval: Number(options.frameInterval),
      parallelFrames: Number(options.parallelFrames),
      outputDir: outputDir,
      tempDir: options.temp,
      startTime: options.start,
      endTime: options.end,
    });

    logger.debug(
      "Video Processor Options:",
      {
        frameInterval: Number(options.frameInterval),
        parallelFrames: Number(options.parallelFrames),
        analyzer: !!videoProcessor.analyzer,
        output: outputDir,
        temp: options.temp,
      },
      "\n"
    );

    // Set up event handlers
    videoProcessor.on("processing", (event) => handleProcessingEvent(event));
    videoProcessor.on("error", (event) => handleErrorEvent(event));
    videoProcessor.on("debug", (event) => handleDebugEvent(event));

    await processVideosInParallel(
      videos,
      resolvedInput,
      videoProcessor,
      Number(options.jobs)
    );
  });

program.parseAsync().catch((error) => {
  if (error instanceof Error) {
    logger.error(`✖️ ${error.message}`, "\n");

    if (error.cause) {
      const message = error instanceof Error ? error.message : String(error);
      logger.debug(message, "\n");
    }

    if (error.stack) {
      logger.debug("Error Stack:", error.stack);
    }
  }
  process.exit(1);
});
