import type { AnalyzerConfig } from "./criteria";

export interface VideoProcessorConfig {
  analyzerConfig?: AnalyzerConfig;
  frameInterval: number;
  parallelFrames: number;
  outputDir: string;
  tempDir: string;
  startTime?: string; // Optional start time in format HH:MM:SS or MM:SS
  endTime?: string; // Optional end time in format HH:MM:SS or MM:SS
}

export type VideoProcessorEventMap = {
  processing: [ProcessingEvent];
  error: [ErrorEvent];
  debug: [DebugEvent];
};

export type AnalyzerEventMap = {
  error: [ErrorEvent];
  debug: [DebugEvent];
};

export type ProcessingEvent =
  | InitProcessingEvent
  | CreatingDirectoriesEvent
  | AnalyzingFramesEvent
  | ExtractingFramesEvent
  | ApplyingModificationsEvent
  | CompilingVideoEvent
  | CleanupEvent
  | CompleteEvent;

export type FrameAnalysis = {
  action: "speed_up" | "remove" | "keep";
  confidence: number;
  frame: number;
  reason?: string;
};

export type CleanupEvent = {
  stage: "cleanup";
  message: string;
};

export type ExtractingFramesEvent = {
  stage: "extracting_frames";
  message: string;
  data?: {
    progress: {
      current: number;
      total: number;
      percentage: number;
    };
  };
};

export type ApplyingModificationsEvent = {
  stage: "applying_modifications";
  message: string;
  data?: FrameAnalysis;
};

export type InitProcessingEvent = {
  stage: "init";
  message: string;
  data: {
    videoPath: string;
  };
};

export type CreatingDirectoriesEvent = {
  stage: "creating_directories";
  message: string;
  data: string[];
};

export type AnalyzingFramesEvent = {
  stage: "analyzing_frames";
  message: string;
  data?: {
    progress: {
      current: number;
      total: number;
      percentage: number;
    };
  };
};

export type CompilingVideoEvent = {
  stage: "compiling_video";
  message: string;
  data?: {
    progress: {
      current: number;
      total: number | null;
      percentage: number;
    };
  };
};

export type CompleteEvent = {
  stage: "complete";
  message: string;
  data: {
    outputPath: string;
    timeElapsed: number;
  };
};

export type ErrorEvent = {
  type: "error";
  message: string;
  data?: unknown;
};

export type DebugEvent =
  | {
      type: "debug" | "warning";
      message: string;
      data?: unknown;
    }
  | {
      type: "command";
      message: string;
      data: string;
    };
