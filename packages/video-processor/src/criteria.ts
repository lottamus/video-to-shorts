import { z } from "zod";

export const analyzerConfigSchema = z.object({
  speedUp: z.string().optional(),
  remove: z.string().optional(),
  keep: z.string().optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  openaiApiKey: z.string().min(1),
});

export type AnalyzerConfig = z.infer<typeof analyzerConfigSchema>;

export const DEFAULT_CRITERIA = {
  speedUp:
    "Content is repetitive, slow, or less interesting but still relevant",
  remove: "Content is unwanted, irrelevant, or of poor quality",
  keep: "Content is interesting, important, or high quality",
  confidenceThreshold: 0.7,
} as const;
