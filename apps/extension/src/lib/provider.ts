import { compactTranscriptForPrompt } from "@app/shared";
import type {
  AppLocale,
  AnalyzeResponse,
  ChatHistoryMessage,
  CustomSkill,
  PageContext,
  ProviderConfig
} from "@app/shared";

export type ProviderMode =
  | "quick-summary"
  | "summary"
  | "qa"
  | "frame-analysis"
  | "mindmap";

interface ProviderRequest {
  mode: ProviderMode;
  context: PageContext;
  locale?: AppLocale;
  activeSkills: CustomSkill[];
  providerConfig: ProviderConfig;
  question?: string;
  imageBase64?: string;
  imageBase64List?: string[];
  conversationHistory?: ChatHistoryMessage[];
}

interface ChatMessageContentPart {
  type: string;
  text?: string;
  image_url?: {
    url: string;
  };
}

interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatMessageContentPart[];
}

export const MAX_CONVERSATION_CONTEXT_CHARS = 200_000;

function buildSkillText(
  target: "summary" | "qa" | "frame-analysis",
  skills: CustomSkill[]
) {
  return skills
    .filter((skill) => skill.enabled && skill.targets.includes(target))
    .map((skill) => `Skill: ${skill.name}\nInstruction: ${skill.prompt}`)
    .join("\n\n");
}

function formatDuration(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }

  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, remainingSeconds]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  }

  return [minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function buildCurrentEpisodeLabel(context: PageContext, locale: AppLocale) {
  if (!context.pageNumber && !context.episodeTitle) {
    return "";
  }

  if (locale === "en") {
    if (context.pageNumber && context.episodeTitle) {
      return `Current selected episode: P${context.pageNumber} - ${context.episodeTitle}`;
    }

    if (context.pageNumber) {
      return `Current selected episode: P${context.pageNumber}`;
    }

    return `Current selected episode: ${context.episodeTitle}`;
  }

  if (context.pageNumber && context.episodeTitle) {
    return `当前选集：P${context.pageNumber} - ${context.episodeTitle}`;
  }

  if (context.pageNumber) {
    return `当前选集：P${context.pageNumber}`;
  }

  return `当前选集：${context.episodeTitle}`;
}

function buildNoteLabel(context: PageContext, locale: AppLocale) {
  if (!context.noteText) {
    return "";
  }

  return locale === "en"
    ? `Bilibili note content: ${context.noteText}`
    : `B站笔记内容：${context.noteText}`;
}

function getTranscriptSource(context: PageContext, locale: AppLocale) {
  const sourceText =
    context.transcriptText ??
    context.subtitleText ??
    (locale === "en" ? "No subtitle available" : "暂无字幕");

  return compactTranscriptForPrompt(sourceText, locale);
}

function buildVocabularyMindmapRule(locale: AppLocale) {
  if (locale === "en") {
    return [
      "Vocabulary lesson rule: if the video is a vocabulary, word-list, language-learning, CET-4/CET-6, IELTS, TOEFL, or English lesson, extract as many important English headwords from the whole transcript as possible.",
      "For each vocabulary item, preserve the English headword exactly and include compact study details such as part of speech, Chinese meaning, collocation, synonym or contrast, and usage note when available.",
      "Do not keep only a few sample words when the transcript contains many vocabulary items. Organize the full lesson into topic clusters or timeline groups while preserving broad coverage."
    ].join("\n\n");
  }

  return [
    "词汇课规则：如果这是词汇课、单词精讲、英语学习、四六级/CET、雅思、托福等视频，请尽量从整段转录中提取完整的重要英文词表。",
    "每个单词节点必须保留英文原词，并尽量压缩标注词性、中文释义、搭配、近反义或对比关系、用法要点。",
    "当转录里有很多词时，不要只保留几个示例词；请按讲解顺序或主题分组，尽量覆盖整节课的核心词汇。"
  ].join("\n\n");
}

function buildVisualMindmapFallbackRule(context: PageContext, locale: AppLocale) {
  const hasTextContext = Boolean(context.transcriptText?.trim() || context.subtitleText?.trim());

  if (hasTextContext) {
    return "";
  }

  if (locale === "en") {
    return [
      "Visual fallback rule: no subtitle or transcript is available. If an attached current video frame or sampled frames from the whole video are provided, use OCR-style visual reading to extract visible English words, phrases, formulas, and board text from the images.",
      "For vocabulary lessons, build the mind map from visible English words in the sampled frames, keep their chronological order when possible, and clearly mark whether the result is based on sampled frames rather than a full-video transcript.",
      "deduplicate repeated vocabulary items: merge duplicates, keep the clearest meaning/collocation, and avoid listing the same English headword multiple times.",
      "Do not output only 'transcript missing' if the attached frame contains readable learning content."
    ].join("\n\n");
  }

  return [
    "画面兜底规则：当前没有可用字幕或转录。如果请求里附带了当前视频画面或整条视频的抽样画面，请像 OCR 一样读取画面中可见的英文单词、短语、公式和板书文字。",
    "如果这是词汇课，请优先根据抽样画面中可见的英文词生成思维导图，并尽量按画面时间顺序组织；同时明确说明结果基于抽样画面，不是完整视频转录。",
    "请对重复单词去重：同一个英文词只保留一次，合并最清楚的释义、搭配和用法，避免重复列出。",
    "如果附带画面里有可读学习内容，不要只输出“转录缺失”。"
  ].join("\n\n");
}

function buildMindmapOcrSupplementRule(locale: AppLocale) {
  if (locale === "en") {
    return [
      "OCR is a final supplement, not the main source.",
      "If frame images are attached, first judge only when the model can identify readable learning content such as words, formulas, slides, board text, or key labels.",
      "OCR only those useful visible parts, deduplicate repeated OCR items, and use them only to fill gaps or enrich the mind map; do not replace or contradict the speech transcript."
    ].join("\n\n");
  }

  return [
    "OCR 只是最后的补充，不是主要依据。",
    "如果请求里附带了抽帧画面，请先判断哪些画面确实有可读的学习内容，例如单词、公式、课件、板书或关键标签。",
    "只 OCR 这些有用的可见部分，对重复 OCR 结果去重，并且只用来补充或完善思维导图；不要替代或推翻语音转写内容。"
  ].join("\n\n");
}

export function buildQuickSummaryPrompt(
  context: PageContext,
  locale: AppLocale,
  skills: CustomSkill[],
  extraInstruction?: string
) {
  const currentEpisodeLabel = buildCurrentEpisodeLabel(context, locale);
  const noteLabel = buildNoteLabel(context, locale);
  const sourceText = getTranscriptSource(context, locale);

  if (locale === "en") {
    return [
      "You are an AI study assistant for Bilibili videos.",
      "Task: Quick Summary.",
      currentEpisodeLabel
        ? "Only summarize the current selected episode or current part."
        : "Summarize the current video briefly.",
      "Do not create a timeline. Do not output timestamp ranges.",
      "Keep the answer compact and useful for a learner.",
      `Video title: ${context.title}`,
      `Video description: ${context.description || "N/A"}`,
      currentEpisodeLabel,
      `Subtitle or page text: ${sourceText}`,
      noteLabel,
      buildSkillText("summary", skills),
      extraInstruction ? `Extra instruction: ${extraInstruction}` : "",
      "Output format:",
      "1. Quick Summary",
      "2. Key Points",
      "3. What to Review Next"
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    "你是 B 站 AI 视频分析助手。",
    "任务：快速摘要。",
    currentEpisodeLabel
      ? "只总结当前选中的这一集或当前分 P。"
      : "请简短总结当前视频。",
    "不要生成时间轴，不要输出时间段。",
    "回答要短、清楚、适合学习者快速了解内容。",
    `视频标题：${context.title}`,
    `视频简介：${context.description || "无"}`,
    currentEpisodeLabel,
    `字幕或页面文本：${sourceText === "No subtitle available" ? "暂无字幕" : sourceText}`,
    noteLabel,
    buildSkillText("summary", skills),
    extraInstruction ? `补充要求：${extraInstruction}` : "",
    "输出格式：",
    "1. 快速摘要",
    "2. 关键知识点",
    "3. 接下来该复习什么"
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildSummaryPrompt(
  context: PageContext,
  locale: AppLocale,
  skills: CustomSkill[],
  extraInstruction?: string
) {
  const durationLabel = formatDuration(context.duration);
  const subtitleOrTranscript = getTranscriptSource(context, locale);
  const hasTimestampedTranscript = /^\[\d{2}:\d{2}/m.test(context.transcriptText ?? "");
  const currentEpisodeLabel = buildCurrentEpisodeLabel(context, locale);
  const noteLabel = buildNoteLabel(context, locale);
  const timestampRule =
    locale === "en"
      ? hasTimestampedTranscript
        ? "Timestamp rule: the transcript contains exact [start - end] timestamps. Use those timestamps as the only evidence for timeline boundaries. Do not move a concept, formula, example, or scene to a different time range than where it appears in the transcript."
        : "Timestamp rule: no timestamped full transcript is available. Use conservative approximate ranges only, and avoid pretending the ranges are exact."
      : hasTimestampedTranscript
        ? "时间戳规则：转录里已经包含精确的 [开始 - 结束] 时间戳。时间轴边界必须以这些时间戳为依据，不要把某个概念、公式、例题或画面内容移动到它没有出现过的时间段。"
        : "时间戳规则：当前没有带时间戳的完整转录。只能给保守的近似时间段，不要假装时间段是精确的。";

  if (locale === "en") {
    return [
      "You are an AI study assistant for Bilibili videos.",
      currentEpisodeLabel
        ? "This is a multi-episode or multi-part Bilibili video. Only summarize the currently selected episode, not the entire collection."
        : "Your task is not a generic summary. Analyze the whole video in chronological order.",
      "Your task is not a generic summary. Analyze the current video content in chronological order.",
      "The output must be in English, and each timeline segment should stay concise.",
      `Video title: ${context.title}`,
      `Video description: ${context.description || "N/A"}`,
      `Uploader: ${context.uploader || "Unknown"}`,
      currentEpisodeLabel,
      durationLabel
        ? `Actual video duration: ${durationLabel} (${Math.floor(context.duration ?? 0)} seconds)`
        : "",
      `Subtitle or transcript: ${subtitleOrTranscript}`,
      timestampRule,
      noteLabel,
      buildSkillText("summary", skills),
      extraInstruction ? `Extra instruction: ${extraInstruction}` : "",
      "Output format:",
      "1. Start with: Overall Summary",
      "2. Then write: Timeline Analysis",
      "3. Split the video into several meaningful sections based on topic shifts, scene changes, demonstrations, or argument transitions.",
      "4. Under Timeline Analysis, every section must begin with a time range in this format: 00:00 - 01:12",
      "5. The time ranges do not need to be equal length. They should follow the content naturally.",
      "6. Keep the time ranges in ascending order and cover the whole video as much as possible.",
      "7. After each time range, write only 1 to 2 short sentences, but make them specific rather than generic.",
      "8. For each segment, mention the exact concept, formula, example, theorem, or conclusion being explained whenever possible.",
      "9. Use the subtitle, transcript, and note content as primary evidence for deciding segment boundaries and wording.",
      "10. Avoid splitting the video into fixed 30-second chunks unless the content truly changes that often.",
      durationLabel
        ? `11. Never invent timestamps beyond the real video duration. The final end time must be less than or equal to ${durationLabel}.`
        : "11. Do not invent overly long timestamps or stretch the video beyond the available content.",
      "12. If a segment contains a definition, calculation step, derivation, example, or key distinction, call that out directly.",
      "13. End with: Final Takeaway",
      "14. Do not switch to Chinese."
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    "你是一个中文 AI 学习助手，专门分析 Bilibili 视频。",
    currentEpisodeLabel
      ? "这是一个多选集或分 P 视频。你只总结当前正在播放的这一集，不要把整条 BV 的其他选集一起总结进去。"
      : "你的任务不是普通摘要，而是按整条视频的时间顺序做一步一步的分析。",
    "你的任务不是普通摘要，而是按当前视频内容的时间顺序做一步一步的分析。",
    "输出必须是中文，而且每个时间段后面的说明要简短、清楚、直接。",
    `视频标题：${context.title}`,
    `视频简介：${context.description || "无"}`,
    `UP 主：${context.uploader || "未知"}`,
    currentEpisodeLabel,
    durationLabel ? `视频真实总时长：${durationLabel}（${Math.floor(context.duration ?? 0)} 秒）` : "",
    `字幕或转录：${subtitleOrTranscript === "No subtitle available" ? "暂无字幕" : subtitleOrTranscript}`,
    timestampRule,
    noteLabel,
    buildSkillText("summary", skills),
    extraInstruction ? `补充要求：${extraInstruction}` : "",
    "输出格式必须严格遵守：",
    "1. 先写“整体概览”",
    "2. 再写“时间轴分析”",
    "3. 按内容变化自然分段，比如话题切换、场景变化、演示步骤变化、观点转折。",
    "4. 在“时间轴分析”下面，每一段都必须用这种格式开头：00:00 - 01:12",
    "5. 时间段不需要固定长度，要根据内容决定每一段的边界。",
    "6. 时间段必须按顺序排列，并尽量覆盖整条视频。",
    "7. 每个时间段后面只写 1 到 2 句简短摘要，但一定要具体，不要写空泛概括。",
    "8. 每一段尽量点明这一段到底在讲什么具体概念、公式、定理、例题、计算步骤或结论。",
    "9. 优先根据字幕、转录和笔记内容来判断分段边界与摘要内容。",
    "10. 不要机械地每 30 秒切一段，除非内容真的在那样变化。",
    durationLabel
      ? `11. 绝对不要编造超过真实总时长的时间点，最后一个结束时间必须小于或等于 ${durationLabel}。`
      : "11. 不要随意把视频时长写长，时间段要贴近现有内容。",
    "12. 如果某一段是在下定义、做推导、讲例题、列性质、做对比或给结论，要直接写出来。",
    "13. 最后写“最终结论”",
    "14. 不要输出英文标题，不要写松散散文，重点是中文时间轴分段摘要。"
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildQaPrompt(
  context: PageContext,
  locale: AppLocale,
  skills: CustomSkill[],
  question: string
) {
  if (locale === "zh") {
    return [
      "你是一个中文 AI 学习助手，负责回答 Bilibili 视频相关问题。",
      `视频标题：${context.title}`,
      buildCurrentEpisodeLabel(context, locale),
      `当前播放时间：${Math.floor(context.currentTime)} 秒`,
      `字幕或转录：${getTranscriptSource(context, locale)}`,
      buildSkillText("qa", skills),
      `用户问题：${question}`,
      "请用中文清晰回答，必要时引用时间点。"
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    "You are an AI study assistant for Bilibili videos.",
    `Video title: ${context.title}`,
    buildCurrentEpisodeLabel(context, locale),
    `Current playback time: ${Math.floor(context.currentTime)} seconds`,
    `Subtitle or transcript: ${getTranscriptSource(context, locale)}`,
    buildSkillText("qa", skills),
    `User question: ${question}`,
    "Answer clearly and concisely. Refer to timestamps when helpful."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildQaSystemPrompt(
  context: PageContext,
  locale: AppLocale,
  skills: CustomSkill[]
) {
  if (locale === "zh") {
    return [
      "你是一个中文 AI 学习助手，负责回答 Bilibili 视频相关问题。",
      `视频标题：${context.title}`,
      buildCurrentEpisodeLabel(context, locale),
      `当前播放时间：${Math.floor(context.currentTime)} 秒`,
      `字幕或转录：${getTranscriptSource(context, locale)}`,
      buildNoteLabel(context, locale),
      buildSkillText("qa", skills),
      "请结合已有对话上下文继续回答，保持连贯、直接、清楚，必要时引用时间点。"
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    "You are an AI study assistant for Bilibili videos.",
    `Video title: ${context.title}`,
    buildCurrentEpisodeLabel(context, locale),
    `Current playback time: ${Math.floor(context.currentTime)} seconds`,
    `Subtitle or transcript: ${getTranscriptSource(context, locale)}`,
    buildNoteLabel(context, locale),
    buildSkillText("qa", skills),
    "Use the existing conversation history to keep the reply consistent, direct, and context-aware. Refer to timestamps when helpful."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildFramePrompt(
  context: PageContext,
  locale: AppLocale,
  skills: CustomSkill[],
  question?: string
) {
  if (locale === "zh") {
    return [
      "你是一个中文 AI 助手，负责图像理解和学习辅助。",
      `视频标题：${context.title}`,
      buildCurrentEpisodeLabel(context, locale),
      buildSkillText("frame-analysis", skills),
      question ? `补充要求：${question}` : "",
      "请用中文描述当前画面里的关键信息，并说明它在视频里的作用。"
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    "You are an AI assistant for image understanding and study support.",
    `Video title: ${context.title}`,
    buildCurrentEpisodeLabel(context, locale),
    buildSkillText("frame-analysis", skills),
    question ? `Extra instruction: ${question}` : "",
    "Describe the key visual information in the current frame and explain why it matters in the learning context of the video."
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildMindmapPrompt(
  context: PageContext,
  locale: AppLocale,
  skills: CustomSkill[],
  extraInstruction?: string
) {
  const currentEpisodeLabel = buildCurrentEpisodeLabel(context, locale);
  const noteLabel = buildNoteLabel(context, locale);
  const transcriptLabel = getTranscriptSource(context, locale);
  const subtitleSupportLabel = context.subtitleText?.trim()
    ? locale === "en"
      ? `Subtitle support only: ${context.subtitleText}`
      : `字幕辅助参考：${context.subtitleText}`
    : "";
  const vocabularyMindmapRule = buildVocabularyMindmapRule(locale);
  const ocrSupplementRule = buildMindmapOcrSupplementRule(locale);

  if (locale === "en") {
    return [
      "You are generating a mind map for a Bilibili study assistant.",
      "Focus only on the current selected episode or current part. Do not mix in other episodes from the same BV collection.",
      "Speech transcript is the primary source for the mind map; subtitles are only supporting evidence for corrections or small supplements.",
      `Video title: ${context.title}`,
      currentEpisodeLabel,
      `Primary speech transcript: ${transcriptLabel}`,
      subtitleSupportLabel,
      noteLabel,
      buildSkillText("summary", skills),
      extraInstruction ? `Extra instruction: ${extraInstruction}` : "",
      vocabularyMindmapRule,
      ocrSupplementRule,
      "Pick the single best layout type from: tree, timeline, cluster, comparison.",
      "Choose timeline for step-by-step teaching or process flow, tree for layered concepts, cluster for parallel topics, and comparison for contrasts.",
      "Do not use tree as the default layout. Prefer cluster when the content is organized as several parallel sections, and choose tree only when the hierarchy itself is the key insight.",
      "Keep every node label short, accurate, and readable. Avoid noisy symbol strings or raw notation unless it is truly necessary.",
      "If a formula or notation is needed, keep it brief and add a natural-language explanation.",
      "Return only one JSON code block with this shape:",
      '{ "type": "tree", "title": "short title", "summary": "one sentence", "nodes": [{ "label": "node", "children": [] }] }'
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    "你是 B 站学习助手里的思维导图生成器。",
    "只围绕当前视频当前选集或当前分 P 的内容生成思维导图，不要把同一个 BV 下的其他选集混进来。",
    "语音转写文本是生成思维导图的主要依据，字幕只作为纠错和少量补充参考。",
    `视频标题：${context.title}`,
    currentEpisodeLabel,
    `主要语音转写：${transcriptLabel}`,
    subtitleSupportLabel,
    noteLabel,
    buildSkillText("summary", skills),
    extraInstruction ? `补充要求：${extraInstruction}` : "",
    vocabularyMindmapRule,
    ocrSupplementRule,
    "请先判断当前选集内容最适合哪一种导图类型，再从下面几种里只选择一种输出：tree、timeline、cluster、comparison。",
    "选择建议：流程讲解选 timeline，层级知识选 tree，并列主题选 cluster，对比内容选 comparison。",
    "不要把 tree 当成默认答案。如果内容更像几个并列主题或章节，请优先选 cluster；只有在“层级关系本身”是重点时才选 tree。",
    "每个节点文案都要短、准、自然，避免堆砌乱七八糟的符号或生硬公式串。",
    "如果必须出现公式或记号，请尽量简短，并补一句自然语言说明。",
    "只返回一个 JSON 代码块，格式如下：",
    '{ "type": "tree", "title": "短标题", "summary": "一句话概括", "nodes": [{ "label": "节点", "children": [] }] }'
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildProviderEndpoint(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");

  if (!trimmed) {
    return "";
  }

  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }

  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/chat/completions`;
  }

  return `${trimmed}/v1/chat/completions`;
}

export function buildTranscriptionEndpoint(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");

  if (!trimmed) {
    return "";
  }

  if (trimmed.endsWith("/audio/transcriptions")) {
    return trimmed;
  }

  if (trimmed.endsWith("/chat/completions")) {
    return trimmed.replace(/\/chat\/completions$/, "/audio/transcriptions");
  }

  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/audio/transcriptions`;
  }

  return `${trimmed}/v1/audio/transcriptions`;
}

export function trimConversationHistory(
  messages: ChatHistoryMessage[],
  maxChars = MAX_CONVERSATION_CONTEXT_CHARS
) {
  const normalized = messages
    .map((message) => ({
      role: message.role,
      content: message.content.trim()
    }))
    .filter((message) => message.content.length > 0);

  let usedChars = 0;
  const kept: ChatHistoryMessage[] = [];

  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const message = normalized[index];
    const nextCost = message.content.length + 32;

    if (kept.length > 0 && usedChars + nextCost > maxChars) {
      break;
    }

    kept.push(message);
    usedChars += nextCost;
  }

  return kept.reverse();
}

function normalizeAssistantText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (
          item &&
          typeof item === "object" &&
          "text" in item &&
          typeof item.text === "string"
        ) {
          return item.text;
        }

        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

function dataUrlToBlob(dataUrl: string) {
  const [header = "", payload = ""] = dataUrl.split(",", 2);
  const mimeMatch = header.match(/^data:([^;]+);base64$/);

  if (!mimeMatch || !payload) {
    throw new Error("Invalid audio data. Expected a base64 data URL.");
  }

  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], {
    type: mimeMatch[1]
  });
}

function pickAudioFileName(mimeType: string) {
  if (mimeType.includes("webm")) {
    return "bilibili-audio.webm";
  }

  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) {
    return "bilibili-audio.mp3";
  }

  if (mimeType.includes("wav")) {
    return "bilibili-audio.wav";
  }

  return "bilibili-audio.m4a";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function shouldUseTencentBackendTranscription(providerConfig: ProviderConfig) {
  return providerConfig.asrProvider === "tencent";
}

function shouldUseDashScopeOssBackendTranscription(providerConfig: ProviderConfig) {
  return providerConfig.asrProvider === "dashscope-oss";
}

function getConfiguredTranscriptionBackendOrigin(providerConfig: ProviderConfig) {
  const origin =
    providerConfig.transcriptionBackendUrl?.trim() ||
    import.meta.env.VITE_TRANSCRIPTION_BACKEND_ORIGIN?.trim() ||
    "";

  if (!origin) {
    throw new Error(
      "Please fill in your self-hosted Backend URL in API Settings and click Apply first."
    );
  }

  return origin.replace(/\/+$/, "");
}

function getTencentTranscriptionBackendEndpoint(providerConfig: ProviderConfig) {
  const origin = getConfiguredTranscriptionBackendOrigin(providerConfig);
  return `${origin.replace(/\/+$/, "")}/api/transcribe/tencent`;
}

function getDashScopeOssTranscriptionBackendEndpoint(providerConfig: ProviderConfig) {
  const origin = getConfiguredTranscriptionBackendOrigin(providerConfig);
  return `${origin.replace(/\/+$/, "")}/api/transcribe/dashscope-oss`;
}

function normalizeTranscriptionText(data: unknown): string {
  if (!data || typeof data !== "object") {
    return "";
  }

  const record = data as {
    text?: unknown;
    transcript?: unknown;
    segments?: unknown;
    result?: unknown;
  };

  if (typeof record.text === "string") {
    return record.text.trim();
  }

  if (typeof record.transcript === "string") {
    return record.transcript.trim();
  }

  if (typeof record.result === "string") {
    return record.result.trim();
  }

  if (Array.isArray(record.segments)) {
    return record.segments
      .map((segment) =>
        segment &&
        typeof segment === "object" &&
        "text" in segment &&
        typeof segment.text === "string"
          ? segment.text
          : ""
      )
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

function normalizeImageList(imageBase64?: string | string[]) {
  if (Array.isArray(imageBase64)) {
    return imageBase64.filter((image) => image.trim().length > 0);
  }

  return imageBase64?.trim() ? [imageBase64] : [];
}

export function createUserContent(
  prompt: string,
  imageBase64?: string | string[],
  enableVision?: boolean
) {
  const imageBase64List = normalizeImageList(imageBase64);

  if (imageBase64List.length > 0 && enableVision) {
    const parts: ChatMessageContentPart[] = [
      {
        type: "text",
        text: prompt
      }
    ];

    for (const imageUrl of imageBase64List) {
      parts.push({
        type: "image_url",
        image_url: {
          url: imageUrl
        }
      });
    }

    return parts;
  }

  if (imageBase64List.length > 0 && !enableVision) {
    return `${prompt}\n\nNote: vision support is currently disabled in the selected provider configuration, so the attached image frames will not be analyzed in this request.`;
  }

  return prompt;
}

export async function requestAudioTranscription({
  providerConfig,
  audioBase64,
  audioBlob
}: {
  providerConfig: ProviderConfig;
  audioBase64?: string;
  audioBlob?: Blob;
}) {
  if (!providerConfig.apiKey.trim()) {
    throw new Error("Please fill in your API Key in API Settings and click Apply first.");
  }

  if (shouldUseTencentBackendTranscription(providerConfig)) {
    if (!audioBlob) {
      throw new Error("Tencent Cloud ASR needs an uploaded audio blob, but none was available.");
    }

    return requestTencentBackendTranscription({
      providerConfig,
      audioBlob
    });
  }

  if (shouldUseDashScopeOssBackendTranscription(providerConfig)) {
    if (!audioBlob) {
      throw new Error("DashScope OSS transcription needs an uploaded audio blob, but none was available.");
    }

    return requestDashScopeOssBackendTranscription({
      providerConfig,
      audioBlob
    });
  }

  if (!audioBase64) {
    throw new Error(
      "This provider needs an uploaded audio file for transcription, but no audio data was available."
    );
  }

  const endpoint = buildTranscriptionEndpoint(providerConfig.baseUrl);
  const uploadedAudioBlob = dataUrlToBlob(audioBase64);
  const formData = new FormData();

  formData.append("file", uploadedAudioBlob, pickAudioFileName(uploadedAudioBlob.type));
  formData.append("model", providerConfig.transcriptionModel?.trim() || "whisper-1");
  formData.append("response_format", "json");

  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${providerConfig.apiKey.trim()}`
      },
      body: formData
    });
  } catch (error) {
    throw new Error(
      `Unable to reach transcription endpoint. Endpoint: ${endpoint}. Detail: ${getErrorMessage(error)}`
    );
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Provider transcription failed with status ${response.status}. Endpoint: ${endpoint}. Detail: ${detail}`
    );
  }

  const body = normalizeTranscriptionText(await response.json());

  if (!body) {
    throw new Error("The transcription provider returned no readable transcript text.");
  }

  return body;
}

async function requestTencentBackendTranscription({
  providerConfig,
  audioBlob
}: {
  providerConfig: ProviderConfig;
  audioBlob: Blob;
}) {
  const secretId = providerConfig.tencentSecretId?.trim();
  const secretKey = providerConfig.tencentSecretKey?.trim();

  if (!secretId || !secretKey) {
    throw new Error("Please fill in Tencent SecretId and SecretKey in API Settings and click Apply first.");
  }

  const endpoint = getTencentTranscriptionBackendEndpoint(providerConfig);
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": audioBlob.type || "application/octet-stream",
        "X-Tencent-Secret-Id": secretId,
        "X-Tencent-Secret-Key": secretKey,
        "X-Tencent-Engine-Model-Type":
          providerConfig.tencentEngineModelType?.trim() || "16k_zh_large"
      },
      body: audioBlob
    });
  } catch (error) {
    throw new Error(
      `Unable to reach Tencent ASR backend. Endpoint: ${endpoint}. Detail: ${getErrorMessage(error)}`
    );
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Tencent ASR backend failed with status ${response.status}. Endpoint: ${endpoint}. Detail: ${detail}`
    );
  }

  const data = (await response.json()) as {
    error?: unknown;
    debug?: unknown;
    transcriptText?: unknown;
  };

  if (typeof data.error === "string" && data.error.trim()) {
    const debugText = data.debug ? ` Debug: ${JSON.stringify(data.debug).slice(0, 1200)}` : "";
    throw new Error(`Tencent ASR backend error: ${data.error.trim()}.${debugText}`);
  }

  const transcriptText =
    typeof data.transcriptText === "string" ? data.transcriptText.trim() : "";

  if (!transcriptText) {
    const debugText = data.debug ? ` Debug: ${JSON.stringify(data.debug).slice(0, 1200)}` : "";
    throw new Error(`Tencent ASR backend returned no readable transcript text.${debugText}`);
  }

  return transcriptText;
}

async function requestDashScopeOssBackendTranscription({
  providerConfig,
  audioBlob
}: {
  providerConfig: ProviderConfig;
  audioBlob: Blob;
}) {
  const ossAccessKeyId = providerConfig.ossAccessKeyId?.trim();
  const ossAccessKeySecret = providerConfig.ossAccessKeySecret?.trim();
  const ossRegion = providerConfig.ossRegion?.trim();
  const ossBucket = providerConfig.ossBucket?.trim();

  if (!ossAccessKeyId || !ossAccessKeySecret || !ossRegion || !ossBucket) {
    throw new Error("Please fill in OSS AccessKeyId, AccessKeySecret, region, and bucket in API Settings and click Apply first.");
  }

  const endpoint = getDashScopeOssTranscriptionBackendEndpoint(providerConfig);
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": audioBlob.type || "application/octet-stream",
        "X-DashScope-Api-Key": providerConfig.apiKey.trim(),
        "X-DashScope-Base-Url": providerConfig.baseUrl.trim(),
        "X-DashScope-Model":
          providerConfig.transcriptionModel?.trim() || "fun-asr",
        "X-OSS-Access-Key-Id": ossAccessKeyId,
        "X-OSS-Access-Key-Secret": ossAccessKeySecret,
        "X-OSS-Region": ossRegion,
        "X-OSS-Bucket": ossBucket,
        "X-OSS-Endpoint": providerConfig.ossEndpoint?.trim() || ""
      },
      body: audioBlob
    });
  } catch (error) {
    throw new Error(
      `Unable to reach DashScope OSS transcription backend. Endpoint: ${endpoint}. Detail: ${getErrorMessage(error)}`
    );
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `DashScope OSS transcription backend failed with status ${response.status}. Endpoint: ${endpoint}. Detail: ${detail}`
    );
  }

  const data = (await response.json()) as {
    error?: unknown;
    debug?: unknown;
    transcriptText?: unknown;
  };

  if (typeof data.error === "string" && data.error.trim()) {
    const debugText = data.debug ? ` Debug: ${JSON.stringify(data.debug).slice(0, 1200)}` : "";
    throw new Error(`DashScope OSS transcription backend error: ${data.error.trim()}.${debugText}`);
  }

  const transcriptText =
    typeof data.transcriptText === "string" ? data.transcriptText.trim() : "";

  if (!transcriptText) {
    const debugText = data.debug ? ` Debug: ${JSON.stringify(data.debug).slice(0, 1200)}` : "";
    throw new Error(`DashScope OSS transcription backend returned no readable transcript text.${debugText}`);
  }

  return transcriptText;
}

function buildMessages(request: ProviderRequest): ProviderMessage[] {
  const locale = request.locale ?? "zh";

  if (request.mode === "qa") {
    const question =
      request.question?.trim() ||
      (locale === "zh" ? "请继续基于当前视频回答。": "Please continue based on the current video.");
    const trimmedHistory = trimConversationHistory(request.conversationHistory ?? []);

    return [
      {
        role: "system",
        content: buildQaSystemPrompt(request.context, locale, request.activeSkills)
      },
      ...trimmedHistory.map((message) => ({
        role: message.role,
        content: message.content
      })),
      {
        role: "user",
        content: createUserContent(
          question,
          request.imageBase64List ?? request.imageBase64,
          request.providerConfig.visionEnabled
        )
      }
    ];
  }

  return [
    {
      role: "system",
      content:
        "You are a precise AI learning assistant. Answer clearly, structurally, and with useful detail."
    },
    {
      role: "user",
      content: createUserContent(
        buildPrompt(request),
        request.imageBase64List ?? request.imageBase64,
        request.providerConfig.visionEnabled
      )
    }
  ];
}

function buildRequestTitle(mode: ProviderMode, locale: AppLocale = "zh") {
  if (mode === "quick-summary") {
    return locale === "en" ? "Quick Summary" : "快速摘要";
  }

  if (mode === "summary") {
    return locale === "en" ? "Detailed Summary" : "细节摘要";
  }

  if (mode === "qa") {
    return locale === "en" ? "Answer Ready" : "对话结果";
  }

  if (mode === "frame-analysis") {
    return locale === "en" ? "Frame Analysis" : "图片分析结果";
  }

  return locale === "en" ? "Mind Map" : "思维导图";
}

function buildPrompt(request: ProviderRequest) {
  const locale = request.locale ?? "zh";

  if (request.mode === "quick-summary") {
    return buildQuickSummaryPrompt(request.context, locale, request.activeSkills, request.question);
  }

  if (request.mode === "summary") {
    return buildSummaryPrompt(request.context, locale, request.activeSkills, request.question);
  }

  if (request.mode === "qa") {
    return buildQaPrompt(
      request.context,
      locale,
      request.activeSkills,
      request.question || "Continue analyzing this video."
    );
  }

  if (request.mode === "frame-analysis") {
    return buildFramePrompt(request.context, locale, request.activeSkills, request.question);
  }

  return buildMindmapPrompt(request.context, locale, request.activeSkills, request.question);
}

export async function requestProviderAnalysis(
  request: ProviderRequest
): Promise<AnalyzeResponse> {
  const { providerConfig } = request;

  if (!providerConfig.apiKey.trim()) {
    throw new Error("Please fill in your API Key in API Settings and click Apply first.");
  }

  const endpoint = buildProviderEndpoint(providerConfig.baseUrl);
  const messages = buildMessages(request);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${providerConfig.apiKey.trim()}`
    },
    body: JSON.stringify({
      model: providerConfig.model.trim(),
      messages,
      temperature: 0.5
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Provider request failed with status ${response.status}. Endpoint: ${endpoint}. Detail: ${detail}`
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };

  const body = normalizeAssistantText(data.choices?.[0]?.message?.content);

  if (!body) {
    throw new Error("The provider returned successfully, but there was no readable content.");
  }

  return {
    title: buildRequestTitle(request.mode, request.locale ?? "zh"),
    body
  };
}
