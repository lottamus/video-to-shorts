import path from "node:path";
import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzerConfig } from "../criteria";
import { VideoProcessor } from "../processor";
import type {
  DebugEvent,
  ErrorEvent,
  ProcessingEvent,
  VideoProcessorConfig,
} from "../types";

const createChainableFfmpeg = () => {
  const chainable = {
    run: vi.fn(() => {}),
    output: vi.fn(() => chainable),
    outputOptions: vi.fn(() => chainable),
    inputOptions: vi.fn(() => chainable),
    complexFilter: vi.fn(() => chainable),
    map: vi.fn(() => chainable),
    setStartTime: vi.fn(() => chainable),
    setDuration: vi.fn(() => chainable),
    // Add progress event emitter
    on: (event: string, cb: (data: unknown) => void) => {
      if (event === "end") {
        setTimeout(cb, 0);
      } else if (event === "progress") {
        setTimeout(() => cb({ percent: 100 }), 0);
      } else if (event === "start") {
        setTimeout(() => {
          // Emit resizing event when ffmpeg starts
          cb([
            {
              stage: "resizing",
              message: "Resizing video...",
            },
          ]);
        }, 0);
      }
      return chainable;
    },
  };
  return chainable;
};

// Mock OpenAI
vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        name: "analyzeFrame",
                        arguments: JSON.stringify({
                          action: "keep",
                          confidence: 0.9,
                          reason: "Test frame analysis",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        },
      };
    },
  };
});

// Mock external dependencies
vi.mock("fluent-ffmpeg", () => {
  const mockFfmpeg = () => createChainableFfmpeg();

  return { default: mockFfmpeg };
});

vi.mock("fs-extra", () => ({
  default: {
    ensureDir: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    remove: vi.fn().mockReturnValue(Promise.resolve()),
  },
}));

describe("VideoProcessor", () => {
  let processor: VideoProcessor;
  let config: VideoProcessorConfig;
  let analyzerConfig: AnalyzerConfig;
  const processingListener = vi.fn<(event: ProcessingEvent) => void>();
  const errorListener = vi.fn<(event: ErrorEvent) => void>();
  const debugListener = vi.fn<(event: DebugEvent) => void>();

  beforeEach(() => {
    analyzerConfig = {
      speedUp: "Content is repetitive or slow",
      remove: "Content is unwanted",
      keep: "Content is interesting",
      confidenceThreshold: 0.7,
      openaiApiKey: "test-key",
      openaiBaseUrl: "https://api.openai.com/v1",
    };
    config = {
      analyzerConfig,
      frameInterval: 1,
      parallelFrames: 2,
      outputDir: "/test/output",
      tempDir: "/test/temp",
    };
    processor = new VideoProcessor(config);

    processor.on("processing", processingListener);
    processor.on("error", errorListener);
    processor.on("debug", debugListener);

    // Reset all mocks before each test
    vi.clearAllMocks();
  });

  it("should initialize with correct configuration", () => {
    expect(processor).toBeInstanceOf(VideoProcessor);
    expect(processor.analyzer).toBeDefined();
  });

  it("should initialize with start and end time options", () => {
    const processorWithTimes = new VideoProcessor({
      ...config,
      startTime: "00:30",
      endTime: "01:30",
    });
    expect(processorWithTimes).toBeInstanceOf(VideoProcessor);
  });

  it("should initialize without analyzer when criteria is not provided", () => {
    const processorWithoutAnalyzer = new VideoProcessor({
      frameInterval: config.frameInterval,
      parallelFrames: config.parallelFrames,
      outputDir: config.outputDir,
      tempDir: config.tempDir,
    });
    expect(processorWithoutAnalyzer.analyzer).toBeUndefined();
  });

  it("should validate analyzer config", () => {
    // Invalid confidence threshold
    expect(
      () =>
        new VideoProcessor({
          ...config,
          analyzerConfig: {
            ...analyzerConfig,
            confidenceThreshold: 1.5,
          },
        })
    ).toThrow(
      "Invalid analyzer config: confidenceThreshold: Number must be less than or equal to 1"
    );

    // Missing required openaiApiKey
    expect(
      () =>
        new VideoProcessor({
          ...config,
          // @ts-expect-error -- Test is validating missing openaiApiKey
          analyzerConfig: {
            speedUp: "test",
          } satisfies Partial<AnalyzerConfig>,
        })
    ).toThrow("Invalid analyzer config: openaiApiKey: Required");

    // Empty openaiApiKey
    expect(
      () =>
        new VideoProcessor({
          ...config,
          analyzerConfig: {
            ...analyzerConfig,
            openaiApiKey: "",
          },
        })
    ).toThrow(
      "Invalid analyzer config: openaiApiKey: String must contain at least 1 character(s)"
    );
  });

  it("should skip analysis when analyzer is not available", async () => {
    const processorWithoutAnalyzer = new VideoProcessor({
      frameInterval: config.frameInterval,
      parallelFrames: config.parallelFrames,
      outputDir: config.outputDir,
      tempDir: config.tempDir,
    });
    const videoPath = "/test/input/video.mp4";

    // Mock readdir to return some frame files
    vi.mocked(fs.readdir).mockImplementation(() =>
      Promise.resolve(["frame-1.jpg"])
    );
    vi.mocked(fs.readFile).mockImplementation(() =>
      Promise.resolve("mock-base64-data")
    );

    expect(processorWithoutAnalyzer.analyzer).toBeUndefined();

    await processorWithoutAnalyzer.processVideo(videoPath);

    // Verify no analysis events were emitted
    expect(processingListener).not.toHaveBeenCalledWith<[ProcessingEvent]>(
      expect.objectContaining({
        stage: "analyzing_frames",
      })
    );
  });

  it("should handle start and end times in config", async () => {
    const processorWithTimes = new VideoProcessor({
      ...config,
      startTime: "00:30",
      endTime: "01:30",
    });

    const videoPath = "/test/input/video.mp4";
    vi.mocked(fs.readdir).mockImplementation(() =>
      Promise.resolve(["frame-1.jpg"])
    );
    vi.mocked(fs.readFile).mockImplementation(() =>
      Promise.resolve("mock-base64-data")
    );

    const ffmpegMock = await import("fluent-ffmpeg");
    const chainableFfmpeg = createChainableFfmpeg();
    // @ts-expect-error - Test is validating mockFfmpeg
    vi.spyOn(ffmpegMock, "default").mockImplementation(() => chainableFfmpeg);

    // Call processVideo to trigger ffprobe
    await processorWithTimes.processVideo(videoPath);

    // Verify ffprobe was called to get video dimensions
    expect(chainableFfmpeg.run).toHaveBeenCalled();
    expect(chainableFfmpeg.setStartTime).toHaveBeenCalledWith("00:30");
    expect(chainableFfmpeg.setDuration).toHaveBeenCalledWith(60);
  });

  it("should handle start and end times in filenames", async () => {
    const processor = new VideoProcessor(config);
    const videoPath = "/test/input/00:00:30-00:01:30.mp4";

    vi.mocked(fs.readdir).mockImplementation(() =>
      Promise.resolve(["frame-1.jpg"])
    );
    vi.mocked(fs.readFile).mockImplementation(() =>
      Promise.resolve("mock-base64-data")
    );

    const ffmpegMock = await import("fluent-ffmpeg");
    const chainableFfmpeg = createChainableFfmpeg();
    // @ts-expect-error - Test is validating mockFfmpeg
    vi.spyOn(ffmpegMock, "default").mockImplementation(() => chainableFfmpeg);

    await processor.processVideo(videoPath);

    // Verify ffmpeg was called with correct start time and duration
    expect(chainableFfmpeg.setStartTime).toHaveBeenCalledWith("00:00:30");
    expect(chainableFfmpeg.setDuration).toHaveBeenCalledWith(60); // 01:30 - 00:30 = 60 seconds
  });

  it("should emit video processing events", async () => {
    const videoPath = "/test/input/video.mp4";
    const videoName = path.basename(videoPath, path.extname(videoPath));
    const tempFramesDir = path.join(config.tempDir, videoName);
    const outputPath = path.join(config.outputDir, `${videoName}.mp4`);

    // Mock readdir to return some frame files
    const mockFrames = ["frame-1.jpg", "frame-2.jpg", "frame-3.jpg"];
    vi.mocked(fs.readdir).mockImplementation(() => Promise.resolve(mockFrames));
    vi.mocked(fs.readFile).mockImplementation(() =>
      Promise.resolve("mock-base64-data")
    );

    await processor.processVideo(videoPath);

    expect(processingListener).toHaveBeenNthCalledWith<[ProcessingEvent]>(1, {
      stage: "init",
      message: "Processing video",
      data: {
        videoPath,
      },
    });

    expect(processingListener).toHaveBeenNthCalledWith<[ProcessingEvent]>(2, {
      stage: "creating_directories",
      message: "Creating directories...",
      data: [tempFramesDir, config.outputDir],
    });

    expect(processingListener).toHaveBeenNthCalledWith<[ProcessingEvent]>(3, {
      stage: "extracting_frames",
      message: "Extracting frames...",
    });

    expect(processingListener).toHaveBeenNthCalledWith<[ProcessingEvent]>(4, {
      stage: "analyzing_frames",
      message: "Analyzing frames...",
    });

    expect(processingListener).toHaveBeenNthCalledWith<[ProcessingEvent]>(5, {
      stage: "analyzing_frames",
      message: "Analyzing frames: 33.3% (1/3)",
      data: {
        progress: {
          current: 1,
          total: mockFrames.length,
          percentage: expect.any(Number),
        },
      },
    });

    expect(processingListener).toHaveBeenNthCalledWith<[ProcessingEvent]>(8, {
      stage: "applying_modifications",
      message: "Applying modifications...",
    });

    expect(processingListener).toHaveBeenNthCalledWith<[ProcessingEvent]>(9, {
      stage: "compiling_video",
      message: "Compiling video...",
    });

    expect(processingListener).toHaveBeenNthCalledWith<[ProcessingEvent]>(10, {
      stage: "compiling_video",
      message: "Compiling video (100%)",
      data: expect.objectContaining({
        progress: expect.objectContaining({
          current: expect.any(Number),
          total: null,
          percentage: 100,
        }),
      }),
    });

    expect(processingListener).toHaveBeenNthCalledWith<[ProcessingEvent]>(11, {
      stage: "cleanup",
      message: "Cleaning up temporary files...",
    });

    expect(processingListener).toHaveBeenNthCalledWith<[ProcessingEvent]>(12, {
      stage: "complete",
      message: "Processing complete! Output saved to: /test/output/video.mp4",
      data: expect.objectContaining({
        outputPath,
        timeElapsed: expect.any(Number),
      }),
    });

    expect(errorListener).not.toHaveBeenCalled();
  });

  it("should cleanup temporary files", async () => {
    const videoPath = "/test/input/video.mp4";
    const videoName = path.basename(videoPath, path.extname(videoPath));
    const tempFramesDir = path.join(config.tempDir, videoName);

    // Mock readdir to return some frame files
    vi.mocked(fs.readdir).mockImplementation(() =>
      Promise.resolve(["frame-1.jpg"])
    );
    vi.mocked(fs.readFile).mockImplementation(() =>
      Promise.resolve("mock-base64-data")
    );

    await processor.processVideo(videoPath);

    // Verify cleanup event was emitted
    expect(processingListener).toHaveBeenCalledWith<[ProcessingEvent]>({
      stage: "cleanup",
      message: "Cleaning up temporary files...",
    });

    // Verify temp directory was removed
    expect(vi.mocked(fs.remove)).toHaveBeenCalledWith(tempFramesDir);
  });

  it("should re-emit Analyzer error events", async () => {
    const videoPath = "/test/input/video.mp4";
    const outputPath = "/test/output/video.mp4";
    const mockError = new Error("OpenAI API error");

    const OpenAI = await import("openai");

    class MockOpenAI {
      chat = {
        completions: {
          create: vi.fn().mockRejectedValueOnce(mockError),
        },
      };
    }

    // @ts-expect-error - Test is validating mockOpenAI
    vi.spyOn(OpenAI, "default").mockImplementation(() => new MockOpenAI());

    const processor = new VideoProcessor(config);

    processor.on("error", errorListener);
    processor.on("processing", processingListener);

    vi.mocked(fs.readdir).mockImplementation(() =>
      Promise.resolve(["frame-1.jpg"])
    );
    vi.mocked(fs.readFile).mockImplementation(() =>
      Promise.resolve("mock-base64-data")
    );

    await processor.processVideo(videoPath);

    // Verify error event was emitted
    expect(errorListener).toHaveBeenCalledExactlyOnceWith<[ErrorEvent]>({
      type: "error",
      message: "Error response from OpenAI. Defaulting to keep frame.",
      data: {
        error: mockError,
        frame: 1,
        frameBase64: "mock-base64-data",
      },
    });

    expect(processingListener).toHaveBeenLastCalledWith<[ProcessingEvent]>({
      stage: "complete",
      message: `Processing complete! Output saved to: ${outputPath}`,
      data: {
        outputPath,
        timeElapsed: expect.any(Number),
      },
    });
  });
});
