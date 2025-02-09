import type { FrameAnalysis } from "./analyzer";

export type ProcessingStage =
  | "init"
  | "creating_directories"
  | "extracting_frames"
  | "analyzing_frames"
  | "applying_modifications"
  | "cleanup"
  | "complete"
  | "resizing";

export type ProcessingEvent = {
  stage: ProcessingStage;
  message: string;
  data?: {
    outputPath?: string;
    progress?: {
      current: number;
      total: number;
      percentage: number;
    };
    frame?: {
      number: number;
      action: FrameAnalysis["action"];
      confidence: number;
    };
  };
};

export type DebugEvent = {
  type: "debug" | "error";
  message: string;
  data?: unknown;
};
