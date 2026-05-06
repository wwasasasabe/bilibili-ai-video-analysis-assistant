import { compactTranscriptForPrompt } from "@app/shared";
import type { AppLocale, CustomSkill, PageContext } from "@app/shared";
import { resolveSkills } from "./skillResolver";

function buildSkillText(
  target: "summary" | "qa" | "frame-analysis",
  skills: CustomSkill[]
) {
  return resolveSkills(target, skills)
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
  skills: CustomSkill[],
  locale: AppLocale = "zh",
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
  skills: CustomSkill[],
  locale: AppLocale = "zh",
  extraInstruction?: string
) {
  const durationLabel = formatDuration(context.duration);
  const currentEpisodeLabel = buildCurrentEpisodeLabel(context, locale);
  const noteLabel = buildNoteLabel(context, locale);
  const transcriptLabel = getTranscriptSource(context, locale);
  const hasTimestampedTranscript = /^\[\d{2}:\d{2}/m.test(context.transcriptText ?? "");
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
        ? "This is a multi-episode or multi-part video. Only analyze the current selected episode."
        : "Analyze the current video in chronological order.",
      `Video title: ${context.title}`,
      `Video description: ${context.description || "N/A"}`,
      `Uploader: ${context.uploader || "Unknown"}`,
      currentEpisodeLabel,
      durationLabel
        ? `Actual video duration: ${durationLabel} (${Math.floor(context.duration ?? 0)} seconds)`
        : "",
      `Subtitle or transcript: ${transcriptLabel}`,
      timestampRule,
      noteLabel,
      buildSkillText("summary", skills),
      extraInstruction ? `Extra instruction: ${extraInstruction}` : "",
      "Output format:",
      "1. Start with: Overall Summary",
      "2. Then write: Timeline Analysis",
      "3. Each section should start with a time range like 00:00 - 01:12.",
      "4. After each time range, write 1 to 2 concise but specific sentences.",
      "5. Mention the exact concept, formula, example, theorem, distinction, or conclusion in that segment whenever possible.",
      "6. Use subtitle, transcript, and note content as the main evidence for both boundaries and wording.",
      durationLabel
        ? `7. Never invent timestamps later than ${durationLabel}.`
        : "7. Do not invent timestamps beyond the available content.",
      "8. End with: Final Takeaway."
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    "你是一个 B 站学习助手，需要按内容推进顺序分析当前视频。",
    currentEpisodeLabel
      ? "这是多选集或多分 P 视频。只分析当前正在看的这一集，不要混入其他选集。"
      : "不要给泛泛摘要，要按当前视频内容的推进顺序做时间轴分析。",
    `视频标题：${context.title}`,
    `视频简介：${context.description || "无"}`,
    `UP 主：${context.uploader || "未知"}`,
    currentEpisodeLabel,
    durationLabel
      ? `视频真实总时长：${durationLabel}（${Math.floor(context.duration ?? 0)} 秒）`
      : "",
    `字幕或转录：${transcriptLabel}`,
    timestampRule,
    noteLabel,
    buildSkillText("summary", skills),
    extraInstruction ? `补充要求：${extraInstruction}` : "",
    "输出格式：",
    "1. 先写“整体概览”",
    "2. 再写“时间轴分析”",
    "3. 每一段都用这种格式开头：00:00 - 01:12",
    "4. 每个时间段后面只写 1 到 2 句简洁说明，但一定要写具体内容。",
    "5. 尽量点明该时间段里的具体概念、公式、例题、定理、性质、步骤或结论。",
    "6. 优先根据字幕、转录和笔记来判断时间段边界与摘要内容。",
    durationLabel ? `7. 不要编造超过 ${durationLabel} 的时间点。` : "7. 不要编造超出已有内容的时间点。",
    "8. 最后写“最终结论”。"
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildQaPrompt(
  context: PageContext,
  skills: CustomSkill[],
  question: string,
  locale: AppLocale = "zh"
) {
  const currentEpisodeLabel = buildCurrentEpisodeLabel(context, locale);

  if (locale === "en") {
    return [
      "You answer questions about a Bilibili video.",
      `Video title: ${context.title}`,
      currentEpisodeLabel,
      `Current playback time: ${Math.floor(context.currentTime)} seconds`,
      `Subtitle or transcript: ${getTranscriptSource(context, locale)}`,
      buildSkillText("qa", skills),
      `Question: ${question}`,
      "Answer clearly and cite timestamps when helpful."
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    "你负责回答和 Bilibili 当前视频有关的问题。",
    `视频标题：${context.title}`,
    currentEpisodeLabel,
    `当前播放时间：${Math.floor(context.currentTime)} 秒`,
    `字幕或转录：${getTranscriptSource(context, locale)}`,
    buildSkillText("qa", skills),
    `问题：${question}`,
    "请用中文清晰回答，必要时引用时间点。"
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildFramePrompt(
  context: PageContext,
  skills: CustomSkill[],
  locale: AppLocale = "zh",
  extraInstruction?: string
) {
  const currentEpisodeLabel = buildCurrentEpisodeLabel(context, locale);

  if (locale === "en") {
    return [
      "You analyze a paused Bilibili video frame.",
      `Video title: ${context.title}`,
      currentEpisodeLabel,
      buildSkillText("frame-analysis", skills),
      extraInstruction ? `Extra instruction: ${extraInstruction}` : "",
      "Describe the visible content and explain why it matters in the learning context."
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    "你负责分析一张来自 Bilibili 视频的暂停画面。",
    `视频标题：${context.title}`,
    currentEpisodeLabel,
    buildSkillText("frame-analysis", skills),
    extraInstruction ? `补充要求：${extraInstruction}` : "",
    "请描述画面中的关键信息，并说明它在当前视频学习上下文中的作用。"
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildMindmapPrompt(
  context: PageContext,
  skills: CustomSkill[],
  locale: AppLocale = "zh",
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
