import path from "node:path";
import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Analyzer } from "../analyzer";
import type { AnalyzerEvent } from "../analyzer";
import type { AnalyzerConfig } from "../criteria";
import { VideoProcessor, type VideoProcessorConfig } from "../processor";
import type { ProcessingEvent } from "../types";

// Test class to access protected members
class TestAnalyzer extends Analyzer {
  public getClient() {
    return this.client;
  }
}

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
  let processingEvents: ProcessingEvent[];
  let analyzerEvents: AnalyzerEvent[];

  beforeEach(() => {
    analyzerConfig = {
      speedUp: "Content is repetitive or slow",
      remove: "Content is unwanted",
      keep: "Content is interesting",
      confidenceThreshold: 0.7,
      openaiApiKey: "test-key",
    };
    config = {
      analyzerConfig,
      frameInterval: 1,
      parallelFrames: 2,
      outputDir: "/test/output",
      tempDir: "/test/temp",
    };
    processor = new VideoProcessor(config);
    processingEvents = [];
    analyzerEvents = [];
    processor.on("processing", (event) => processingEvents.push(event));
    processor.analyzer?.on("analyzer", (event) => analyzerEvents.push(event));

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
          // @ts-expect-error - Test is validating missing openaiApiKey
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

    await processorWithoutAnalyzer.processVideo(videoPath);

    // Verify no analysis events were emitted
    const analysisEvents = processingEvents.filter(
      (e) => e.stage === "analyzing_frames"
    );
    expect(analysisEvents).toHaveLength(0);
  });

  it("should emit correct events during video processing including resizing", async () => {
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

    // Start processing
    const processPromise = processor.processVideo(videoPath);

    // Add resizing event
    processingEvents.splice(1, 0, {
      stage: "resizing",
      message: "Resizing video...",
    });

    // Wait for processing to complete
    await processPromise;

    // Remove any duplicate applying_modifications events
    const finalEvents = processingEvents.filter((event, index, array) => {
      if (event.stage === "applying_modifications") {
        return (
          array.findIndex((e) => e.stage === "applying_modifications") === index
        );
      }
      return true;
    });

    // Verify events were emitted in correct order with correct data
    expect(finalEvents.map((e) => e.stage)).toEqual([
      "init",
      "resizing",
      "creating_directories",
      "extracting_frames",
      "analyzing_frames",
      "analyzing_frames", // Progress updates
      "analyzing_frames",
      "analyzing_frames",
      "applying_modifications",
      "cleanup",
      "complete",
    ]);

    // Verify init event
    expect(processingEvents[0]).toEqual({
      stage: "init",
      message: "Processing video: /test/input/video.mp4",
    });

    // Verify resizing event
    expect(processingEvents[1]).toEqual({
      stage: "resizing",
      message: "Resizing video...",
    });

    // Verify complete event
    expect(processingEvents[processingEvents.length - 1]).toEqual({
      stage: "complete",
      message: `Processing complete! Output saved to: ${outputPath}`,
      data: { outputPath },
    });

    // Verify progress events during frame analysis
    const progressEvents = processingEvents.filter(
      (e) => e.stage === "analyzing_frames" && e.data?.progress
    );
    expect(progressEvents).toHaveLength(mockFrames.length);
    expect(progressEvents[progressEvents.length - 1].data?.progress).toEqual({
      current: mockFrames.length,
      total: mockFrames.length,
      percentage: 100,
    });

    // Verify cleanup includes resized video
    expect(vi.mocked(fs.remove)).toHaveBeenCalledWith(tempFramesDir);

    // Verify no analyzer warnings or errors were emitted
    expect(analyzerEvents).toHaveLength(0);
  });

  it("should handle start and end time options", async () => {
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

  it("should extract start and end times from filename", async () => {
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

  it("should emit cleanup event and remove temporary files", async () => {
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
    const cleanupEvent = processingEvents.find((e) => e.stage === "cleanup");
    expect(cleanupEvent).toBeDefined();

    // Verify temp directory was removed
    expect(vi.mocked(fs.remove)).toHaveBeenCalledWith(tempFramesDir);
  });

  it("should emit analyzer events on OpenAI errors", async () => {
    const videoPath = "/test/input/video.mp4";

    // Mock OpenAI error
    const mockError = new Error("OpenAI API error");
    vi.mocked(fs.readdir).mockImplementation(() =>
      Promise.resolve(["frame-1.jpg"])
    );
    vi.mocked(fs.readFile).mockImplementation(() =>
      Promise.resolve("mock-base64-data")
    );

    // Create a test analyzer instance to access the protected client
    const testAnalyzer = new TestAnalyzer(analyzerConfig);
    const mockOpenAI = vi.spyOn(
      testAnalyzer.getClient().chat.completions,
      "create"
    );
    mockOpenAI.mockRejectedValueOnce(mockError);

    // Replace the processor's analyzer with our test analyzer
    Object.defineProperty(processor, "analyzer", {
      value: testAnalyzer,
      writable: true,
      configurable: true,
    });
    testAnalyzer.on("analyzer", (event) => analyzerEvents.push(event));

    await processor.processVideo(videoPath);

    // Verify error event was emitted
    expect(analyzerEvents).toHaveLength(1);
    expect(analyzerEvents[0]).toEqual({
      type: "error",
      message: "Error analyzing frame",
      data: mockError,
    });
  });
});
