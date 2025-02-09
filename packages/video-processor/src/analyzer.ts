import { EventEmitter } from "node:events";
import OpenAI from "openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { AnalyzerConfig } from "./criteria";
import { DEFAULT_CRITERIA } from "./criteria";

export type FrameAnalysis = {
  action: "speed_up" | "remove" | "keep";
  confidence: number;
  reason?: string;
};

export type AnalyzerEvent = {
  type: "warning" | "error";
  message: string;
  data?: unknown;
};

function generateSystemPrompt(config: AnalyzerConfig): string {
  return `You are a video editing assistant that analyzes video frames. Your task is to determine whether each frame should be:

1. "speed_up" - When ${config.speedUp ?? DEFAULT_CRITERIA.speedUp}
2. "remove" - When ${config.remove ?? DEFAULT_CRITERIA.remove}
3. "keep" - When ${config.keep ?? DEFAULT_CRITERIA.keep}

Analyze each frame carefully and make your decision based on these criteria.
Consider factors like visual quality, content, movement, and context.`;
}

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
              - speed_up: Content matches speed up criteria
              - remove: Content matches remove criteria
              - keep: Content matches keep criteria`,
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

export class Analyzer extends EventEmitter {
  protected client: OpenAI;
  private config: AnalyzerConfig;

  constructor(config: AnalyzerConfig) {
    super();
    this.client = new OpenAI({
      apiKey: config.openaiApiKey,
    });
    this.config = config;
  }

  async analyzeFrame(frameBase64: string): Promise<FrameAnalysis> {
    try {
      const response = await this.client.chat.completions.create({
        model: "gpt-4-vision-preview",
        messages: [
          {
            role: "system",
            content: generateSystemPrompt(this.config),
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
        tools,
        tool_choice: { type: "function", function: { name: "analyzeFrame" } },
        max_tokens: 150,
      });

      const toolCall = response.choices[0].message.tool_calls?.[0];

      if (toolCall?.function.name === "analyzeFrame") {
        const result = JSON.parse(toolCall.function.arguments) as {
          action: FrameAnalysis["action"];
          confidence: number;
          reason: string;
        };
        return {
          action: result.action,
          confidence: result.confidence,
          reason: result.reason,
        };
      }

      this.emit("analyzer", {
        type: "warning",
        message: "Unexpected response format from OpenAI, defaulting to 'keep'",
      } as AnalyzerEvent);
      return { action: "keep", confidence: 0 };
    } catch (error) {
      this.emit("analyzer", {
        type: "error",
        message: "Error analyzing frame",
        data: error,
      } as AnalyzerEvent);
      return { action: "keep", confidence: 0 };
    }
  }
}
