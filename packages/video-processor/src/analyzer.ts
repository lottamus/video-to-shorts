import { EventEmitter } from "node:events";
import OpenAI from "openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { z } from "zod";
import type { AnalyzerConfig } from "./criteria";
import { DEFAULT_CRITERIA, analyzerConfigSchema } from "./criteria";
import type { AnalyzerEventMap, FrameAnalysis } from "./types";

function generateSystemPrompt(config: AnalyzerConfig): string {
  return `You are a video editing assistant that analyzes video frames. Your task is to determine whether a video frame should be:

1. "speed_up" - When ${config.speedUp ?? DEFAULT_CRITERIA.speedUp}
2. "remove" - When ${config.remove ?? DEFAULT_CRITERIA.remove}
3. "keep" - When ${config.keep ?? DEFAULT_CRITERIA.keep}

Analyze the video frame carefully and make your decision based on these criteria.
Consider factors like visual quality, content, movement, and context.`;
}

function generateTools(config: AnalyzerConfig): ChatCompletionTool[] {
  const tools: ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "analyzeFrame",
        description: "Analyze a video frame and decide how to process it",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["speed_up", "remove", "keep"],
              description: `The action to take on this frame:
                - speed_up: ${config.speedUp ?? DEFAULT_CRITERIA.speedUp}
                - remove: ${config.remove ?? DEFAULT_CRITERIA.remove}
                - keep: ${config.keep ?? DEFAULT_CRITERIA.keep}`,
            },
            reason: {
              type: "string",
              description: "Brief explanation for the chosen action",
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Confidence level in the decision (0-1)",
            },
          },
          required: ["action", "reason", "confidence"],
        },
      },
    },
  ];

  return tools;
}

export class Analyzer extends EventEmitter<AnalyzerEventMap> {
  protected client: OpenAI;
  private config: AnalyzerConfig;
  private systemPrompt: string;
  private tools: ChatCompletionTool[];

  constructor(config: AnalyzerConfig) {
    super();

    const result = analyzerConfigSchema.safeParse(config);
    if (!result.success) {
      const { error } = result;
      throw new Error(
        `Invalid analyzer config: ${error.errors.map((err: z.ZodIssue) => `${err.path.join(".")}: ${err.message}`).join(", ")}`
      );
    }

    this.config = config;
    this.systemPrompt = generateSystemPrompt(this.config);
    this.tools = generateTools(this.config);

    this.client = new OpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl,
    });
  }

  async analyzeFrame(
    frameBase64: string,
    frameNumber: number
  ): Promise<FrameAnalysis> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.config.openaiModel || "gpt-4-vision-preview",
        messages: [
          {
            role: "system",
            content: this.systemPrompt,
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${frameBase64}`,
                },
              },
            ],
          },
        ],
        tools: this.tools,
        tool_choice: { type: "function", function: { name: "analyzeFrame" } },
        max_tokens: 150,
      });

      const toolCall = response.choices[0].message.tool_calls?.[0];

      if (toolCall?.function.name === "analyzeFrame") {
        const result = JSON.parse(toolCall.function.arguments) as FrameAnalysis;
        return {
          action: result.action,
          confidence: result.confidence,
          reason: result.reason,
          frame: frameNumber,
        };
      }

      this.emit("debug", {
        type: "warning",
        message:
          "Unexpected response format from OpenAI. Defaulting to keep frame.",
        data: {
          data: toolCall,
          frame: frameNumber,
          frameBase64,
        },
      });
      return { action: "keep", confidence: 1, frame: frameNumber };
    } catch (error) {
      this.emit("error", {
        type: "error",
        message: "Error response from OpenAI. Defaulting to keep frame.",
        data: {
          error,
          frame: frameNumber,
          frameBase64,
        },
      });

      return { action: "keep", confidence: 1, frame: frameNumber };
    }
  }
}
