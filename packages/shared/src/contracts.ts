import type { z } from "zod";
import {
  customSkillSchema,
  pageContextSchema,
  providerConfigSchema
} from "./schemas";

export type CustomSkill = z.infer<typeof customSkillSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type PageContext = z.infer<typeof pageContextSchema>;
export type AppLocale = "zh" | "en";
export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AnalyzeRequest {
  mode: "quick-summary" | "summary" | "timeline" | "qa" | "frame-analysis" | "mindmap";
  context: PageContext;
  locale?: AppLocale;
  question?: string;
  conversationHistory?: ChatHistoryMessage[];
  activeSkills: CustomSkill[];
  frameImageBase64?: string;
  frameImageBase64List?: string[];
  providerConfig?: ProviderConfig;
}

export interface AnalyzeResponse {
  title: string;
  body: string;
  bullets?: string[];
  timeline?: Array<{ label: string; timestamp: number }>;
}
