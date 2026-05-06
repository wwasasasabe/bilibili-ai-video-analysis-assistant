import type { FastifyInstance } from "fastify";
import {
  type AppLocale,
  customSkillSchema,
  pageContextSchema,
  providerConfigSchema
} from "@app/shared";
import { analyzeFrame } from "../services/frameAnalysisService";
import { callChatCompletion } from "../services/providerAdapter";
import {
  buildFramePrompt,
  buildMindmapPrompt,
  buildQaPrompt,
  buildQuickSummaryPrompt,
  buildSummaryPrompt
} from "../services/promptBuilder";
import { transcribeVideo } from "../services/transcriptionService";

const MAX_CONVERSATION_CONTEXT_CHARS = 200_000;

function parseConversationHistory(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const role =
        "role" in item && (item.role === "user" || item.role === "assistant")
          ? item.role
          : null;
      const content =
        "content" in item && typeof item.content === "string" ? item.content.trim() : "";

      if (!role || !content) {
        return null;
      }

      return { role, content };
    })
    .filter((item): item is { role: "user" | "assistant"; content: string } => Boolean(item));

  let usedChars = 0;
  const kept: typeof normalized = [];

  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const message = normalized[index];
    const nextCost = message.content.length + 32;

    if (kept.length > 0 && usedChars + nextCost > MAX_CONVERSATION_CONTEXT_CHARS) {
      break;
    }

    kept.push(message);
    usedChars += nextCost;
  }

  return kept.reverse();
}

function buildConversationHistoryBlock(
  locale: AppLocale,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>
) {
  if (conversationHistory.length === 0) {
    return "";
  }

  const header = locale === "en" ? "Conversation history:" : "历史对话：";
  const roleLabels =
    locale === "en"
      ? { user: "User", assistant: "Assistant" }
      : { user: "用户", assistant: "助手" };

  return [
    header,
    ...conversationHistory.map(
      (message) => `${roleLabels[message.role]}: ${message.content}`
    )
  ].join("\n");
}

function getLocale(value?: AppLocale) {
  return value === "en" ? "en" : "zh";
}

function getTitle(
  locale: AppLocale,
  mode: "quick-summary" | "summary" | "qa" | "frame-analysis" | "mindmap" | "timeline"
) {
  const labels = {
    zh: {
      "quick-summary": "快速摘要",
      summary: "细节摘要",
      qa: "对话结果",
      "frame-analysis": "图片分析结果",
      mindmap: "思维导图",
      timeline: "时间轴"
    },
    en: {
      "quick-summary": "Quick Summary",
      summary: "Detailed Summary",
      qa: "Answer Ready",
      "frame-analysis": "Frame Analysis",
      mindmap: "Mind Map",
      timeline: "Timeline"
    }
  } as const;

  return labels[locale][mode];
}

function getErrorTitle(
  locale: AppLocale,
  mode: "quick-summary" | "summary" | "qa" | "frame-analysis" | "mindmap"
) {
  const labels = {
    zh: {
      "quick-summary": "快速摘要失败",
      summary: "摘要失败",
      qa: "对话失败",
      "frame-analysis": "图片分析失败",
      mindmap: "思维导图失败"
    },
    en: {
      "quick-summary": "Quick Summary Error",
      summary: "Summary Error",
      qa: "Answer Error",
      "frame-analysis": "Frame Analysis Error",
      mindmap: "Mind Map Error"
    }
  } as const;

  return labels[locale][mode];
}

export default async function analyzeRoutes(app: FastifyInstance) {
  app.post("/analyze", async (request) => {
    const body = request.body as {
      mode: "quick-summary" | "summary" | "timeline" | "qa" | "frame-analysis" | "mindmap";
      context: unknown;
      locale?: AppLocale;
      activeSkills: unknown[];
      question?: string;
      conversationHistory?: unknown;
      frameImageBase64?: string;
      frameImageBase64List?: string[];
      providerConfig?: unknown;
    };

    const context = pageContextSchema.parse(body.context);
    const activeSkills = customSkillSchema.array().parse(body.activeSkills);
    const locale = getLocale(body.locale);
    const conversationHistory = parseConversationHistory(body.conversationHistory);
    const providerConfig = body.providerConfig
      ? providerConfigSchema.parse(body.providerConfig)
      : null;
    const frameImageBase64List = Array.isArray(body.frameImageBase64List)
      ? body.frameImageBase64List.filter(
          (image): image is string => typeof image === "string" && image.trim().length > 0
        )
      : [];
    const hasFrameImages = Boolean(body.frameImageBase64) || frameImageBase64List.length > 0;

    if (body.mode === "timeline") {
      return {
        title: getTitle(locale, "timeline"),
        body:
          locale === "en"
            ? "Timeline mode is reserved for summary-style output."
            : "时间轴模式由摘要结果统一呈现。"
      };
    }

    const resolvedContext =
      context.subtitleText ||
      context.transcriptText ||
      (body.mode === "frame-analysis" && hasFrameImages)
        ? context
        : {
            ...context,
            transcriptText: (await transcribeVideo(context.videoId)).transcriptText
          };

    if (body.mode === "frame-analysis" && body.frameImageBase64) {
      const prompt = buildFramePrompt(resolvedContext, activeSkills, locale, body.question);

      if (providerConfig?.visionEnabled) {
        try {
          const bodyText = await callChatCompletion(
            providerConfig,
            prompt,
            [body.frameImageBase64].filter((image): image is string => Boolean(image))
          );
          return {
            title: getTitle(locale, "frame-analysis"),
            body:
              bodyText ||
              (locale === "en"
                ? "The model returned an empty frame-analysis response."
                : "模型返回了空的图片分析结果。")
          };
        } catch (error) {
          return {
            title: getErrorTitle(locale, "frame-analysis"),
            body: error instanceof Error ? error.message : "Unknown provider error."
          };
        }
      }

      const result = await analyzeFrame(body.frameImageBase64, locale);
      return {
        ...result,
        body: `${prompt}\n\n${result.body}`
      };
    }

    if (body.mode === "qa") {
      const conversationBlock = buildConversationHistoryBlock(locale, conversationHistory);
      const prompt = buildQaPrompt(
        resolvedContext,
        activeSkills,
        [conversationBlock, body.question ?? ""].filter(Boolean).join("\n\n"),
        locale
      );

      if (!providerConfig) {
        return {
          title: getTitle(locale, "qa"),
          body: prompt
        };
      }

      try {
        const bodyText = await callChatCompletion(providerConfig, prompt);
        return {
          title: getTitle(locale, "qa"),
          body:
            bodyText ||
            (locale === "en" ? "The model returned an empty answer." : "模型返回了空的对话结果。")
        };
      } catch (error) {
        return {
          title: getErrorTitle(locale, "qa"),
          body: error instanceof Error ? error.message : "Unknown provider error."
        };
      }
    }

    if (body.mode === "quick-summary") {
      const prompt = buildQuickSummaryPrompt(
        resolvedContext,
        activeSkills,
        locale,
        body.question
      );

      if (!providerConfig) {
        return {
          title: getTitle(locale, "quick-summary"),
          body: prompt
        };
      }

      try {
        const bodyText = await callChatCompletion(providerConfig, prompt);
        return {
          title: getTitle(locale, "quick-summary"),
          body:
            bodyText ||
            (locale === "en" ? "The model returned an empty quick summary." : "模型返回了空的快速摘要。")
        };
      } catch (error) {
        return {
          title: getErrorTitle(locale, "quick-summary"),
          body: error instanceof Error ? error.message : "Unknown provider error."
        };
      }
    }

    if (body.mode === "summary") {
      const prompt = buildSummaryPrompt(
        resolvedContext,
        activeSkills,
        locale,
        body.question
      );

      if (!providerConfig) {
        return {
          title: getTitle(locale, "summary"),
          body: prompt
        };
      }

      try {
        const bodyText = await callChatCompletion(
          providerConfig,
          prompt,
          frameImageBase64List.length > 0
            ? frameImageBase64List
            : [body.frameImageBase64].filter((image): image is string => Boolean(image))
        );
        return {
          title: getTitle(locale, "summary"),
          body:
            bodyText ||
            (locale === "en" ? "The model returned an empty summary." : "模型返回了空的摘要。")
        };
      } catch (error) {
        return {
          title: getErrorTitle(locale, "summary"),
          body: error instanceof Error ? error.message : "Unknown provider error."
        };
      }
    }

    const prompt = buildMindmapPrompt(
      resolvedContext,
      activeSkills,
      locale,
      body.question
    );

    if (!providerConfig) {
      return {
        title: getTitle(locale, "mindmap"),
        body: prompt
      };
    }

    try {
      const bodyText = await callChatCompletion(
        providerConfig,
        prompt,
        frameImageBase64List.length > 0
          ? frameImageBase64List
          : [body.frameImageBase64].filter((image): image is string => Boolean(image))
      );
      return {
        title: getTitle(locale, "mindmap"),
        body:
          bodyText ||
          (locale === "en" ? "The model returned an empty mind map." : "模型返回了空的思维导图。")
      };
    } catch (error) {
      return {
        title: getErrorTitle(locale, "mindmap"),
        body: error instanceof Error ? error.message : "Unknown provider error."
      };
    }
  });
}
