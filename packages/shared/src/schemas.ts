import { z } from "zod";

export const skillTargetSchema = z.enum(["summary", "qa", "frame-analysis"]);

export const customSkillSchema = z.object({
  id: z.string().min(3),
  name: z.string().min(1),
  version: z.string().min(1),
  prompt: z.string().min(10),
  description: z.string().optional(),
  targets: z.array(skillTargetSchema).min(1),
  enabled: z.boolean().default(true)
});

export const providerConfigSchema = z.object({
  provider: z.enum(["deepseek", "qwen", "glm", "minimax", "mimo", "kimi", "custom"]),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  transcriptionModel: z.string().min(1).optional(),
  transcriptionBackendUrl: z.string().url().optional(),
  asrProvider: z.enum(["auto", "openai", "dashscope-oss", "tencent"]).optional(),
  tencentSecretId: z.string().optional(),
  tencentSecretKey: z.string().optional(),
  tencentEngineModelType: z.string().optional(),
  ossAccessKeyId: z.string().optional(),
  ossAccessKeySecret: z.string().optional(),
  ossRegion: z.string().optional(),
  ossBucket: z.string().optional(),
  ossEndpoint: z.string().optional(),
  visionEnabled: z.boolean().default(false)
});

export const pageContextSchema = z.object({
  videoId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  uploader: z.string().default(""),
  pageNumber: z.number().int().positive().optional(),
  episodeTitle: z.string().optional(),
  currentTime: z.number().nonnegative(),
  duration: z.number().positive().optional(),
  subtitleText: z.string().optional(),
  transcriptText: z.string().optional(),
  noteText: z.string().optional(),
  officialSubtitleAvailable: z.boolean().optional()
});
