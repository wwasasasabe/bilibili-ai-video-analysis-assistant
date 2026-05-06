import type { AnalyzeResponse, CustomSkill, PageContext, ProviderConfig } from "@app/shared";
import { toPng } from "html-to-image";
import {
  formatSupportedVideoDuration,
  isSupportedVideoDuration
} from "@app/shared";
import type { ChatHistoryMessage } from "@app/shared";
import JSZip from "jszip";
import { useEffect, useMemo, useRef, useState } from "react";
import { requestProviderAnalysis } from "../lib/provider";
import {
  CUSTOM_PROMPT_STORAGE_KEY,
  getDefaultProviderConfig,
  HISTORY_SESSIONS_STORAGE_KEY,
  LOCALE_STORAGE_KEY,
  normalizeProviderConfig,
  PROVIDER_STORAGE_KEY,
  RESPONSE_PREFERENCE_STORAGE_KEY,
  SKILLS_STORAGE_KEY
} from "../lib/storage";
import { installSkill, toggleSkill } from "../lib/skills";
import { SettingsPanel } from "./components/SettingsPanel";
import { SidebarShell } from "./components/SidebarShell";
import { SkillManager } from "./components/SkillManager";
import { MarkdownContent } from "./components/MarkdownContent";
import {
  getNextFeedbackSelection,
  isFeedbackPreferenceActive,
  type ResponsePreference
} from "./feedback";
import {
  buildAttachmentPrompt,
  extractDocxTextFromXml,
  formatMindMapSourceForDisplay,
  formatFileSize,
  parseMindMapPayload,
  splitMindMapLabel,
  type AttachmentItem,
  type AttachmentKind,
  type MindMapLayout,
  type MindMapPayload,
  type MindMapNode
} from "./utils";

type Screen = "assistant" | "mindmap" | "skill" | "api";
type LoadingMode =
  | "quick-summary"
  | "summary"
  | "qa"
  | "frame-analysis"
  | "mindmap"
  | null;
type Locale = "zh" | "en";
type TranslationDirection = "en-to-zh" | "zh-to-en";
type MindMapLayoutPreference = "auto" | MindMapLayout;
const SUPPORTED_VIDEO_DURATION_LABEL = formatSupportedVideoDuration();

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface HistorySession {
  id: string;
  createdAt: number;
  updatedAt: number;
  locale: Locale;
  videoTitle: string;
  resultTitle: string;
  resultBody: string;
  chatHistory: ChatMessage[];
}

interface TimelineSegment {
  range: string;
  content: string;
}

interface ActionLabels {
  copy: string;
  translate: string;
  like: string;
  dislike: string;
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ThumbsUpIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M9 11V20M9 11 12.7 4.9A1.8 1.8 0 0 1 16 5.8V9h3.2a2 2 0 0 1 2 2.4l-1.2 6A2 2 0 0 1 18 19H9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="3"
        y="10"
        width="6"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ThumbsDownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M9 13V4M9 13l3.7 6.1A1.8 1.8 0 0 0 16 18.2V15h3.2a2 2 0 0 0 2-2.4l-1.2-6A2 2 0 0 0 18 5H9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="3"
        y="4"
        width="6"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M5 7h14M10 11v6M14 11v6M9 7l.6-2h4.8L15 7M7 7l.8 13h8.4L17 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const initialSkills: CustomSkill[] = [
  {
    id: "learning-focus",
    name: "Learning Focus",
    version: "1.0.0",
    prompt: "Highlight practical learning points for viewers.",
    targets: ["summary"],
    enabled: true
  }
];

const demoContext: PageContext = {
  videoId: "BV1-demo",
  title: "Bilibili 学习视频示例",
  description: "用于演示摘要、图片分析、对话和思维导图。",
  uploader: "Demo Uploader",
  pageNumber: 3,
  episodeTitle: "P3 用 AI 整理知识结构",
  currentTime: 42,
  duration: 420,
  officialSubtitleAvailable: true,
  transcriptText:
    "这一集主要讲如何围绕当前视频内容生成摘要、问答结果和多种类型的思维导图。",
  subtitleText:
    "这是一个演示字幕，主要介绍如何使用 AI 侧边栏为视频生成摘要、继续对话，并分析暂停画面。"
};

interface RuntimePageContextResponse {
  ok: boolean;
  context?: PageContext | null;
  error?: string;
}

interface RuntimeFrameResponse extends RuntimePageContextResponse {
  imageBase64?: string | null;
  paused?: boolean;
}

interface SampledVideoFrame {
  time: number;
  imageBase64: string;
}

interface RuntimeFrameSeriesResponse extends RuntimePageContextResponse {
  frames?: SampledVideoFrame[];
  paused?: boolean;
}

type VisualCueCategory =
  | "direct"
  | "operation"
  | "reference"
  | "transition"
  | "comparison"
  | "result"
  | "chart"
  | "emphasis"
  | "question"
  | "step"
  | "dense";

interface VisualCue {
  id?: string;
  text: string;
  startTime: number;
  endTime: number;
  category?: VisualCueCategory;
  confidence?: number;
  delay?: number;
  captureTime?: number;
  sampleTimes?: number[];
  reason?: string;
}

interface VisualCueCandidate extends Required<Omit<VisualCue, "reason">> {
  afterLongSilence: boolean;
  previousText: string;
  nextText: string;
}

interface DenseKeywordWarning {
  startTime: number;
  endTime: number;
  count: number;
}

interface VisualCueJudgement {
  id?: string;
  time?: number;
  keyword?: string;
  score: number;
}

const VISUAL_CUE_AI_SCORE_THRESHOLD = 0.75;

interface RuntimeAudioTranscriptionResponse extends RuntimePageContextResponse {
  transcriptText?: string;
  sourceUrl?: string;
}

function buildConversationHistory(messages: ChatMessage[]): ChatHistoryMessage[] {
  return messages
    .map((message) => ({
      role: message.role,
      content: message.content.trim()
    }))
    .filter((message) => message.content.length > 0);
}

const copy = {
  zh: {
    heroTitle: "B站AI视频分析助手",
    heroSubtitle: "更精简一点的 Bilibili AI 侧边栏",
    previewMode: "当前是本地演示页，显示的是示例视频和示例字幕，不会实时读取 B 站正在播放的内容。",
    language: "语言",
    chip: (count: number) => `${count} 个 skill`,
    screens: {
      assistant: "摘要对话",
      mindmap: "思维导图",
      skill: "Skill 安装",
      api: "API 配置"
    },
    statuses: {
      ready: "准备就绪",
      summary: "正在执行摘要...",
      quickSummary: "正在生成快速摘要...",
      detailedSummary: "正在生成细节摘要...",
      qa: "正在执行对话...",
      frame: "正在执行图片分析...",
      done: "已完成",
      failed: "调用失败",
      mindmap: "正在生成思维导图...",
      samplingFrames: "正在自动抽帧并准备 OCR...",
      transcribing: "正在提取语音并转写...",
      judgingVisualCues: "正在筛选关键画面...",
      mindmapDone: "思维导图已生成",
      mindmapFailed: "生成失败",
      stop: "对话已中止",
      start: "对话已开始"
    },
    resultTitle: "结果",
    resultBody:
      "可以先生成快速摘要，快速了解视频重点；也可以生成细节摘要，按语音转写的时间线一步步分析内容。",
    initialQuestion: "",
    initialAssistant:
      "先生成快速摘要或细节摘要。快速摘要不带时间轴，细节摘要会按语音转写的时间线一步步分析内容。之后你也可以继续追问，或上传图片、Word 和代码。",
    stoppedAssistant: "这一轮对话已经中止。点击“开始”后可以重新继续。",
    restartedAssistant: "新的对话已经开始。你可以继续提问，也可以再次上传附件。",
    loading: "AI 正在思考或回答...",
    answerLoading: "AI 正在回答...",
    continueChat: "继续对话",
    active: "进行中",
    stopped: "已中止",
    remove: "移除",
    dialogue: "对话",
    uploadImage: "上传图片",
    uploadWord: "上传 Word",
    uploadCode: "上传代码",
    history: "历史会话",
    historySearch: "搜索历史会话",
    historyEmpty: "还没有历史会话。",
    historyOpen: "打开",
    historyDelete: "删除",
    historyDeleted: "历史会话已删除。",
    placeholderActive: "",
    placeholderStopped: "",
    stopButton: "中止",
    startButton: "开始",
    send: "发送",
    currentVideo: "当前视频",
    liveNow: "当前内容",
    liveBadge: "实时",
    liveEmpty: "还没抓到当前字幕或片段内容，可能是这条视频暂时没有开启字幕。",
    noSubtitleTitle: "无官方字幕",
    noSubtitleBody:
      "这条 B 站视频目前没有可读的官方字幕。要实现“当前播放内容”的实时显示，需要进入转录模式，由后端先把视频转成字幕再回传给扩展。",
    noSubtitleInline:
      "这条视频当前没有官方字幕，可以点击“转录模式”进入无字幕方案。",
    transcriptionMode: "转录模式",
    summary: "快速摘要",
    speechSummary: "细节摘要",
    imageAnalysis: "图片分析",
    mindmapTitle: "思维导图",
    mindmapNote: "围绕当前选集生成思维导图，支持多种布局，并由 AI 自动选择最适合的一种。",
    generateMindmap: "生成思维导图",
    exportMindmap: "导出图片",
    mindmapLayoutButton: "导图类型",
    mindmapLayoutAuto: "自动",
    mindmapLayoutChoose: "选择导图类型",
    mindmapEmpty: "这里会显示生成后的思维导图。",
    mindmapReadableTitle: "整理后的结果",
    mindmapReadableNote: "这里会把导图结果整理成更清晰、更适合阅读的结构视图。",
    mindmapRawToggle: "查看原始数据",
    attachmentAdded: (kind: string) => `已添加${kind}附件`,
    attachmentKinds: {
      image: "图片",
      word: "Word",
      code: "代码"
    },
    wordDocOnly: "当前只支持提取 .docx 正文内容；旧格式 .doc 文件请先转换为 .docx。",
    wordDocUnreadable: "未能读取这个 Word 文档的正文内容。",
    wordDocEmpty: "这个 Word 文档里没有提取到可读文本。",
    summaryAttachment: "请把附件内容一起纳入摘要。",
    audioSummaryInstruction:
      "请基于完整语音转写文本做细节摘要。必须按时间轴分段；如果转写文本带有时间线线索，要优先使用这些线索。",
    mindmapAudioInstruction:
      "请优先根据完整语音转写生成思维导图，字幕只作为纠错和补充参考；如果附带抽帧画面，请由 AI 判断哪些画面适合 OCR，并只把 OCR 结果作为最后的补充。",
    audioFallbackInstruction:
      "本次没有成功完成音频转写，已改用页面可读的完整字幕或转写文本作为依据。",
    audioUnavailable:
      "没有抓到可转写的音频轨，也没有可用的完整字幕。请确认当前是 B 站视频页，并且所选供应商支持 /audio/transcriptions。",
    videoTooLong: `当前稳定支持 ${SUPPORTED_VIDEO_DURATION_LABEL} 内的视频。请换一个 1 小时 20 分钟内的视频，或选择更短的分 P。`,
    frameQuestion: "请优先分析我上传的这张图片，并结合当前视频上下文给出重点。",
    mindmapQuestion: "请围绕当前视频当前选集内容生成思维导图，并由你自行选择最合适的导图类型。",
    requestFailed: "请求失败。",
    copy: "复制",
    translate: "翻译",
    like: "点赞",
    dislike: "点踩",
    copied: "已复制",
    mindmapExported: "思维导图图片已下载。",
    mindmapExportFailed: "导出思维导图失败。",
    translationTitle: "选中文本翻译",
    translationLoading: "正在翻译选中的内容...",
    translationEmpty: "请先选中一段内容，再点击翻译。",
    translationDirection: "翻译方向",
    enToZh: "英译中",
    zhToEn: "中译英",
    promptTitle: "提示词",
    promptNote: "这里的提示词会一起带入摘要、图片分析、思维导图和对话。",
    promptPlaceholder: "输入你希望 AI 额外遵循的提示词",
    collapseResult: "收起结果",
    expandResult: "展开结果",
    preferenceLiked: "已记录点赞偏好，后续回答会更倾向这种方式。",
    preferenceDisliked: "已记录点踩偏好，后续回答会尽量避开这种方式。",
    preferenceCleared: "已清除回答偏好。"
  },
  en: {
    heroTitle: "Bilibili AI Learning Helper",
    heroSubtitle: "A lighter Bilibili AI sidebar",
    previewMode:
      "You are viewing the local demo page. It shows sample video data and sample subtitles instead of live Bilibili playback.",
    language: "Language",
    chip: (count: number) => `${count} skills`,
    screens: {
      assistant: "Summary Chat",
      mindmap: "Mind Map",
      skill: "Skill Install",
      api: "API Settings"
    },
    statuses: {
      ready: "Ready",
      summary: "Generating summary...",
      quickSummary: "Generating quick summary...",
      detailedSummary: "Generating detailed summary...",
      qa: "Thinking...",
      frame: "Analyzing image...",
      done: "Done",
      failed: "Request failed",
      mindmap: "Generating mind map...",
      samplingFrames: "Sampling video frames for OCR...",
      transcribing: "Extracting audio and transcribing speech...",
      judgingVisualCues: "Selecting key visual moments...",
      mindmapDone: "Mind map ready",
      mindmapFailed: "Mind map failed",
      stop: "Chat stopped",
      start: "Chat started"
    },
    resultTitle: "Result",
    resultBody:
      "Use Quick Summary for a compact overview, or Detailed Summary for a speech-based timeline analysis.",
    initialQuestion: "",
    initialAssistant:
      "Generate a Quick Summary or Detailed Summary first. Quick Summary has no timeline; Detailed Summary follows the speech transcript timeline step by step. Then you can keep chatting here or upload an image, Word file, or code file.",
    stoppedAssistant: "This round has been stopped. Click Start to begin again.",
    restartedAssistant: "A new conversation has started. You can keep asking or upload attachments again.",
    loading: "AI is thinking or responding...",
    answerLoading: "AI is responding...",
    continueChat: "Continue Chat",
    active: "Active",
    stopped: "Stopped",
    remove: "Remove",
    dialogue: "Chat",
    uploadImage: "Upload Image",
    uploadWord: "Upload Word",
    uploadCode: "Upload Code",
    history: "History",
    historySearch: "Search history",
    historyEmpty: "No saved history yet.",
    historyOpen: "Open",
    historyDelete: "Delete",
    historyDeleted: "History session deleted.",
    placeholderActive: "",
    placeholderStopped: "",
    stopButton: "Stop",
    startButton: "Start",
    send: "Send",
    currentVideo: "Current Video",
    liveNow: "Live Segment",
    liveBadge: "LIVE",
    liveEmpty:
      "No current subtitle or segment text was detected yet. This video may not have subtitles enabled.",
    noSubtitleTitle: "No Official Subtitle",
    noSubtitleBody:
      "This Bilibili video does not currently expose any readable official subtitle. To show live segment text for the current playback position, the extension needs transcription mode so the backend can generate subtitles first and send them back.",
    noSubtitleInline:
      "This video currently has no official subtitle. Use Transcription Mode for the no-subtitle workflow.",
    transcriptionMode: "Transcription Mode",
    summary: "Quick Summary",
    speechSummary: "Detailed Summary",
    imageAnalysis: "Image Analysis",
    mindmapTitle: "Mind Map",
    mindmapNote:
      "Generate a mind map for the current selected episode, with multiple layouts and AI choosing the best one automatically.",
    generateMindmap: "Generate Mind Map",
    exportMindmap: "Export Image",
    mindmapLayoutButton: "Layout",
    mindmapLayoutAuto: "Auto",
    mindmapLayoutChoose: "Choose layout",
    mindmapEmpty: "The generated mind map will appear here.",
    mindmapReadableTitle: "Readable View",
    mindmapReadableNote:
      "This view restructures the mind map into a cleaner, easier-to-read outline.",
    mindmapRawToggle: "View Raw Data",
    attachmentAdded: (kind: string) => `${kind} attachment added`,
    attachmentKinds: {
      image: "Image",
      word: "Word",
      code: "Code"
    },
    wordDocOnly: "Only .docx extraction is supported for now. Please convert old .doc files to .docx first.",
    wordDocUnreadable: "Unable to read the body content of this Word document.",
    wordDocEmpty: "No readable text was extracted from this Word document.",
    summaryAttachment: "Please include the attachment content in the summary.",
    audioSummaryInstruction:
      "Create a detailed summary from the full speech transcript. It must be segmented by timeline; if the transcript includes timing cues, use them as primary evidence.",
    mindmapAudioInstruction:
      "Use the full speech transcript as the primary source for the mind map. Subtitles are only supporting evidence for corrections or small supplements. If sampled frames are attached, let the AI decide which frames are suitable for OCR and use OCR only as the final supplement.",
    audioFallbackInstruction:
      "Audio transcription was unavailable for this run, so use the readable full subtitle or transcript from the page instead.",
    audioUnavailable:
      "No transcribable audio track was found, and no full subtitle is available. Make sure this is a Bilibili video page and the selected provider supports /audio/transcriptions.",
    videoTooLong: `Stable analysis currently supports videos up to ${SUPPORTED_VIDEO_DURATION_LABEL}. Please use a shorter video or episode.`,
    frameQuestion: "Analyze the uploaded image first, then combine it with the current video context.",
    mindmapQuestion:
      "Generate a mind map for the current selected episode and choose the most suitable layout type yourself.",
    requestFailed: "Request failed.",
    copy: "Copy",
    translate: "Translate",
    like: "Like",
    dislike: "Dislike",
    copied: "Copied",
    mindmapExported: "Mind map image downloaded.",
    mindmapExportFailed: "Failed to export the mind map.",
    translationTitle: "Selected Translation",
    translationLoading: "Translating the selected text...",
    translationEmpty: "Select some text first, then click translate.",
    translationDirection: "Translation",
    enToZh: "EN to ZH",
    zhToEn: "ZH to EN",
    promptTitle: "Prompt",
    promptNote: "This prompt will be included in summary, image analysis, mind map, and chat requests.",
    promptPlaceholder: "Add extra instructions you want the AI to follow",
    collapseResult: "Collapse Result",
    expandResult: "Expand Result",
    preferenceLiked: "Saved your like preference. Future answers will lean toward this style.",
    preferenceDisliked:
      "Saved your dislike preference. Future answers will try to avoid this style.",
    preferenceCleared: "Response preference cleared."
  }
} as const;

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}

function getMindmapSeed(locale: Locale) {
  if (locale === "en") {
    return "- Video Topic\n  - Core Idea\n  - Key Steps\n    - Step One\n    - Step Two\n  - Action Tips";
  }

  return "- 视频主题\n  - 核心观点\n  - 关键步骤\n    - 第一步\n    - 第二步\n  - 可执行建议";
}

export function translateResultTitle(title: string, locale: Locale) {
  const normalized = title.trim().toLowerCase();
  const titleMap: Record<string, { zh: string; en: string }> = {
    result: { zh: "结果", en: "Result" },
    "结果": { zh: "结果", en: "Result" },
    "timeline summary": { zh: "时间轴摘要", en: "Timeline Summary" },
    "时间轴摘要": { zh: "时间轴摘要", en: "Timeline Summary" },
    "quick summary": { zh: "快速摘要", en: "Quick Summary" },
    "快速摘要": { zh: "快速摘要", en: "Quick Summary" },
    "detailed summary": { zh: "细节摘要", en: "Detailed Summary" },
    "细节摘要": { zh: "细节摘要", en: "Detailed Summary" },
    "summary result": { zh: "摘要结果", en: "Summary Result" },
    "摘要结果": { zh: "摘要结果", en: "Summary Result" },
    "summary ready": { zh: "摘要结果", en: "Summary Result" },
    "answer ready": { zh: "对话结果", en: "Answer Ready" },
    "对话结果": { zh: "对话结果", en: "Answer Ready" },
    "answer result": { zh: "对话结果", en: "Answer Result" },
    "dialogue result": { zh: "对话结果", en: "Dialogue Result" },
    "chat result": { zh: "对话结果", en: "Chat Result" },
    "image analysis result": { zh: "图片分析结果", en: "Image Analysis Result" },
    "图片分析结果": { zh: "图片分析结果", en: "Image Analysis Result" },
    "frame analysis": { zh: "图片分析结果", en: "Frame Analysis" },
    "frame analysis result": { zh: "图片分析结果", en: "Frame Analysis Result" },
    "mind map": { zh: "思维导图", en: "Mind Map" },
    "思维导图": { zh: "思维导图", en: "Mind Map" },
    "request failed": { zh: "请求失败", en: "Request Failed" },
    "请求失败": { zh: "请求失败", en: "Request Failed" },
    "summary error": { zh: "摘要失败", en: "Summary Error" },
    "摘要失败": { zh: "摘要失败", en: "Summary Error" },
    "transcription error": { zh: "转写失败", en: "Transcription Error" },
    "转写失败": { zh: "转写失败", en: "Transcription Error" },
    "answer error": { zh: "对话失败", en: "Answer Error" },
    "对话失败": { zh: "对话失败", en: "Answer Error" },
    "frame analysis error": { zh: "图片分析失败", en: "Frame Analysis Error" }
  };

  return titleMap[normalized]?.[locale] ?? title;
}

export function shouldRenderTimelineSummaryCards(title: string) {
  return (
    title === "时间轴摘要" ||
    title === "Timeline Summary" ||
    title === "细节摘要" ||
    title === "Detailed Summary"
  );
}

export function removeHistorySessionById<T extends { id: string }>(
  sessions: T[],
  sessionId: string
) {
  return sessions.filter((session) => session.id !== sessionId);
}

export function parseTimelineSummary(body: string) {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const segments: TimelineSegment[] = [];
  const overview: string[] = [];
  const takeaway: string[] = [];
  let currentSegment: TimelineSegment | null = null;
  let mode: "overview" | "timeline" | "takeaway" = "overview";

  for (const line of lines) {
    const normalized = line.replace(/[：:]/g, "").toLowerCase();

    if (
      normalized === "整体概览" ||
      normalized === "overall summary" ||
      normalized === "overview"
    ) {
      mode = "overview";
      currentSegment = null;
      continue;
    }

    if (
      normalized === "时间轴分析" ||
      normalized === "timeline analysis" ||
      normalized === "timeline"
    ) {
      mode = "timeline";
      currentSegment = null;
      continue;
    }

    if (
      normalized === "最终结论" ||
      normalized === "final takeaway" ||
      normalized === "takeaway"
    ) {
      mode = "takeaway";
      currentSegment = null;
      continue;
    }

    const timelineLine = line
      .replace(/^(?:[-*•]\s+|\d+[.)]\s*)/, "")
      .trim();
    const timeMatch = timelineLine.match(
      /^(?:\*\*)?(?:\[\s*)?(\d{1,2}:\d{2}(?::\d{2})?\s*-\s*\d{1,2}:\d{2}(?::\d{2})?)(?:\s*\])?(?:\*\*)?(?:\s*[：:|—-]\s*|\s+)?(.*)$/
    );

    if (timeMatch) {
      const segment: TimelineSegment = {
        range: timeMatch[1].trim(),
        content: timeMatch[2].replace(/^\*\*|\*\*$/g, "").trim()
      };
      segments.push(segment);
      currentSegment = segment;
      mode = "timeline";
      continue;
    }

    if (mode === "timeline" && currentSegment) {
      currentSegment.content = currentSegment.content
        ? `${currentSegment.content} ${line}`
        : line;
      continue;
    }

    if (mode === "takeaway") {
      takeaway.push(line);
      continue;
    }

    overview.push(line);
  }

  return {
    overview: overview.join(" ").trim(),
    segments: segments.map((segment) => ({
      ...segment,
      content: segment.content.trim()
    })),
    takeaway: takeaway.join(" ").trim()
  };
}

function parseTimestampToSeconds(value: string) {
  const parts = value.split(":").map((part) => Number(part));

  if (parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return null;
}

function parseTimestampedTranscriptLine(line: string) {
  const match = line
    .trim()
    .match(
      /^(?:[-*•]\s+)?(?:\[\s*)?(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*\])?\s*(.*)$/
    );

  if (!match) {
    return null;
  }

  const startTime = parseTimestampToSeconds(match[1]);
  const endTime = parseTimestampToSeconds(match[2]);

  if (startTime === null || endTime === null) {
    return null;
  }

  return {
    startTime,
    endTime,
    text: match[3].trim()
  };
}

function roundFrameTime(time: number) {
  return Math.round(time * 10) / 10;
}

function isWithinDuration(time: number, duration?: number) {
  return !Number.isFinite(duration) || !duration || time < duration;
}

function buildFrameSampleTimes(captureTime: number, duration?: number) {
  const time = roundFrameTime(captureTime);
  return time >= 0 && isWithinDuration(time, duration) ? [time] : [];
}

function isNoiseOrSilenceText(text: string) {
  const normalized = text.trim().replace(/\s+/g, "");
  return /^\[?(音乐|掌声|噪音|静音|无声|music|applause|noise|silence)\]?$/i.test(
    normalized
  );
}

function isNegativeVisualCue(text: string) {
  const normalized = text.replace(/\s+/g, "");

  return (
    /^(好的|好|嗯|然后呢|然后|OK|ok)$/i.test(normalized) ||
    /(刚才|之前).{0,8}(看到|看过|提到)/.test(normalized) ||
    /(如果|假设).{0,18}(的话|那么)?/.test(normalized)
  );
}

function buildCueMatch(
  text: string,
  category: VisualCueCategory,
  confidence: number,
  delay: number,
  patterns: RegExp[]
) {
  return patterns.some((pattern) => pattern.test(text))
    ? { category, confidence, delay }
    : null;
}

function classifyVisualCue(text: string, afterLongSilence: boolean) {
  if (isNoiseOrSilenceText(text) || isNegativeVisualCue(text)) {
    return null;
  }

  const normalized = text.replace(/\s+/g, "");
  const matches = [
    buildCueMatch(normalized, "step", 0.86, 1.2, [
      /第[一二三四五六七八九十\d]+步/,
      /首先/,
      /其次/,
      /最后/
    ]),
    buildCueMatch(text, "step", 0.86, 1.2, [
      /\b(first|second|third|fourth|final)\s+step\b/i,
      /\bstep\s+\d+\b/i
    ]),
    buildCueMatch(normalized, "direct", 0.9, 0.8, [
      /(我们来看|我们看一下|来看看|看这里|看这个|大家可以看到|你可以看到|可以看到|可以看见|这里展示的是|这边显示的是|请看|请注意看|请大家看一下)/,
      /(接下来|下面).{0,12}(图片|图像|图|画面|场景|镜头|截图|板书|课件|下图)/
    ]),
    buildCueMatch(text, "direct", 0.9, 0.8, [
      /(look at|take a look at|notice|pay attention to|you can see).{0,40}(image|picture|scene|frame|slide|chart|table|screen)/i,
      /(next|following).{0,30}(image|picture|scene|frame|slide|chart|table)/i
    ]),
    buildCueMatch(normalized, "operation", 0.82, 1.5, [
      /(展示|演示|呈现|示范|说明|我来演示一下|我来展示一下|我操作一下)/,
      /(打开|切换到|进入|点击|选择).{0,18}[\u4e00-\u9fa5A-Za-z0-9]/
    ]),
    buildCueMatch(normalized, "operation", 0.84, 2.5, [
      /(我们运行|运行一下|执行|启动|加载)/
    ]),
    buildCueMatch(text, "operation", 0.84, 2.5, [
      /(run|execute|start|launch|load).{0,30}(it|this|the|now|project|app|page|model|code)?/i
    ]),
    buildCueMatch(normalized, "reference", 0.82, 0.8, [
      /(这就是|这个就是|这里就是|这是我们的|这是最终的|这是结果|你看这个|看看这里|注意这个地方|就像这样|是这样的|是这个效果)/
    ]),
    buildCueMatch(normalized, "transition", 0.78, 1.5, [
      /(接下来|下面|然后我们|现在我们来到|接着看|继续往下看|切换到|转到|回到)/
    ]),
    buildCueMatch(normalized, "comparison", 0.86, 2, [
      /(对比一下|比较一下|左边.*右边|之前.*现在|修改前.*修改后|变化|差异|区别|效果对比|原来.*现在)/
    ]),
    buildCueMatch(text, "comparison", 0.86, 2, [
      /(compare|comparison|before.*after|left.*right|difference|changed?|effect comparison)/i
    ]),
    buildCueMatch(normalized, "result", 0.84, 1, [
      /(最终结果|最终效果|输出结果|可以看到结果|结果如下|效果如下|生成了|得到了|产生了|输出了|这就是最终的|完成后是这样的)/
    ]),
    buildCueMatch(text, "result", 0.84, 1, [
      /(final result|result is|output result|generated|produced|we got|effect is|looks like this)/i
    ]),
    buildCueMatch(normalized, "chart", 0.92, 1.5, [
      /(这张图|这幅图|图中|图表显示|这个表格|这份数据|这个图表|如图所示|见图|参考这张图|数据显示|数据表明|从图中可以看出)/
    ]),
    buildCueMatch(text, "chart", 0.92, 1.5, [
      /(this chart|this table|this data|as shown|figure shows|from the chart|data shows)/i
    ]),
    buildCueMatch(normalized, "emphasis", 0.82, 1, [
      /(重点是|关键是|核心是|重要的是|特别注意|注意这里|这里要注意|这个很重要|这一点很关键|大家一定要看清楚|仔细看)/
    ]),
    buildCueMatch(normalized, "question", 0.76, 1, [
      /(为什么.*因为|怎么做.*我们来看|效果如何.*可以看到|答案就是|解释一下)/
    ])
  ].filter((match): match is { category: VisualCueCategory; confidence: number; delay: number } =>
    Boolean(match)
  );

  if (matches.length === 0) {
    return null;
  }

  const bestMatch = matches.reduce((best, match) =>
    match.confidence >= best.confidence ? match : best
  );
  const boostedConfidence = Math.min(
    1,
    bestMatch.confidence + (afterLongSilence ? 0.08 : 0)
  );
  const threshold = afterLongSilence ? 0.5 : 0.7;

  return boostedConfidence >= threshold
    ? {
        ...bestMatch,
        confidence: boostedConfidence
      }
    : null;
}

function chooseRepresentativeCue(left: VisualCueCandidate, right: VisualCueCandidate) {
  if (right.confidence > left.confidence) {
    return right;
  }

  if (right.confidence === left.confidence) {
    return right;
  }

  return left;
}

function shouldMergeCues(left: VisualCueCandidate, right: VisualCueCandidate) {
  if (left.category === "step" || right.category === "step") {
    return false;
  }

  if (right.afterLongSilence) {
    return false;
  }

  const distance = right.endTime - left.endTime;
  const mergeWindow = 10;

  return distance >= 0 && distance <= mergeWindow;
}

function findDenseKeywordWindows(candidates: VisualCueCandidate[]): DenseKeywordWarning[] {
  const windows: DenseKeywordWarning[] = [];
  let index = 0;

  while (index < candidates.length) {
    const startCandidate = candidates[index];
    const windowCandidates = candidates.filter(
      (candidate) =>
        candidate.startTime >= startCandidate.startTime &&
        candidate.startTime - startCandidate.startTime <= 30
    );

    if (windowCandidates.length > 10) {
      const endCandidate = windowCandidates[windowCandidates.length - 1];
      windows.push({
        startTime: startCandidate.startTime,
        endTime: endCandidate.endTime,
        count: windowCandidates.length
      });
      index = candidates.findIndex((candidate) => candidate.endTime > endCandidate.endTime);

      if (index === -1) {
        break;
      }

      continue;
    }

    index += 1;
  }

  return windows;
}

function isInsideDenseWindow(candidate: VisualCueCandidate, windows: DenseKeywordWarning[]) {
  return windows.some(
    (window) => candidate.startTime >= window.startTime && candidate.endTime <= window.endTime
  );
}

function buildDenseWindowCues(windows: DenseKeywordWarning[], duration?: number): VisualCue[] {
  return windows.flatMap((window) => {
    const cues: VisualCue[] = [];

    for (let time = window.startTime + 4.5; time <= window.endTime; time += 9) {
      const captureTime = roundFrameTime(time);
      cues.push({
        text:
          "此段关键词密集，已按时间均匀抽帧。 / Dense keyword window sampled uniformly.",
        startTime: Math.max(window.startTime, captureTime - 1),
        endTime: captureTime,
        category: "dense",
        confidence: 1,
        delay: 0,
        captureTime,
        sampleTimes: buildFrameSampleTimes(captureTime, duration),
        reason: "dense-window"
      });
    }

    return cues;
  });
}

export function buildVisualCueCandidates(transcriptText: string, duration?: number) {
  const transcriptSegments = transcriptText
    .split("\n")
    .map((line) => parseTimestampedTranscriptLine(line))
    .filter(
      (segment): segment is { startTime: number; endTime: number; text: string } =>
        Boolean(segment)
    );
  const candidates: VisualCueCandidate[] = [];
  let previousSegmentEndTime: number | null = null;
  let longSilenceEndedAt: number | null = null;

  for (const [index, segment] of transcriptSegments.entries()) {
    if (
      previousSegmentEndTime !== null &&
      segment.startTime - previousSegmentEndTime > 5
    ) {
      longSilenceEndedAt = segment.startTime;
    }

    previousSegmentEndTime = segment.endTime;

    if (isNoiseOrSilenceText(segment.text)) {
      continue;
    }

    const afterLongSilence =
      longSilenceEndedAt !== null && segment.startTime - longSilenceEndedAt <= 10;
    const match = classifyVisualCue(segment.text, afterLongSilence);

    if (!match) {
      continue;
    }

    const captureTime = roundFrameTime(segment.endTime + 1.2);
    candidates.push({
      id: `cue-${candidates.length}`,
      ...segment,
      category: match.category,
      confidence: match.confidence,
      delay: 1.2,
      captureTime,
      sampleTimes: buildFrameSampleTimes(captureTime, duration),
      afterLongSilence,
      previousText: transcriptSegments[index - 1]?.text ?? "",
      nextText: transcriptSegments[index + 1]?.text ?? ""
    });
  }

  return candidates;
}

function clampScore(score: number) {
  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.max(0, Math.min(1, score));
}

function applyVisualCueJudgements(
  candidates: VisualCueCandidate[],
  judgements?: VisualCueJudgement[]
) {
  if (judgements === undefined) {
    return candidates;
  }

  return candidates
    .map((candidate) => {
      const judgement =
        judgements.find((item) => item.id && item.id === candidate.id) ??
        judgements.find(
          (item) =>
            typeof item.time === "number" &&
            Math.abs(item.time - candidate.endTime) <= 1.5
        );

      if (!judgement) {
        return null;
      }

      return {
        ...candidate,
        confidence: clampScore(judgement.score),
        text: judgement.keyword ? `${candidate.text} (${judgement.keyword})` : candidate.text
      };
    })
    .filter((candidate): candidate is VisualCueCandidate => Boolean(candidate));
}

function capCuesPerMinute(cues: VisualCue[], maxPerMinute = 3) {
  const groups = new Map<number, VisualCue[]>();

  for (const cue of cues) {
    const time = cue.captureTime ?? cue.endTime;
    const minute = Math.floor(time / 60);
    groups.set(minute, [...(groups.get(minute) ?? []), cue]);
  }

  return Array.from(groups.values())
    .flatMap((group) =>
      [...group]
        .sort((left, right) => {
          const confidenceDiff = (right.confidence ?? 0) - (left.confidence ?? 0);

          if (confidenceDiff !== 0) {
            return confidenceDiff;
          }

          return (left.captureTime ?? left.endTime) - (right.captureTime ?? right.endTime);
        })
        .slice(0, maxPerMinute)
    )
    .sort(
      (left, right) =>
        (left.captureTime ?? left.endTime) - (right.captureTime ?? right.endTime)
    );
}

export function buildVisualCueFramePlan(
  transcriptText: string,
  duration?: number,
  judgements?: VisualCueJudgement[]
) {
  const candidates = buildVisualCueCandidates(transcriptText, duration);
  const denseWarnings = findDenseKeywordWindows(candidates);
  const scoredCandidates = applyVisualCueJudgements(candidates, judgements).filter(
    (candidate) => candidate.confidence >= VISUAL_CUE_AI_SCORE_THRESHOLD
  );
  const normalCandidates = scoredCandidates.filter(
    (candidate) => !isInsideDenseWindow(candidate, denseWarnings)
  );
  const cues: VisualCue[] = [];
  let pendingCue: VisualCueCandidate | null = null;

  for (const candidate of normalCandidates) {
    if (!pendingCue) {
      pendingCue = candidate;
      continue;
    }

    if (shouldMergeCues(pendingCue, candidate)) {
      pendingCue = chooseRepresentativeCue(pendingCue, candidate);
      continue;
    }

    cues.push(pendingCue);
    pendingCue = candidate;
  }

  if (pendingCue) {
    cues.push(pendingCue);
  }

  cues.push(...buildDenseWindowCues(denseWarnings, duration));
  const cappedCues = capCuesPerMinute(cues);
  cappedCues.sort((left, right) => left.endTime - right.endTime);

  const frameTimes = Array.from(
    new Set(cappedCues.flatMap((cue) => cue.sampleTimes ?? []))
  ).sort((left, right) => left - right);

  return {
    cues: cappedCues,
    frameTimes,
    denseWarnings,
    candidates
  };
}

export function buildVisualCueJudgementPrompt(
  candidates: VisualCueCandidate[],
  locale: Locale
) {
  const compactCandidates = candidates.map((candidate) => ({
    id: candidate.id,
    time: candidate.endTime,
    text: candidate.text,
    before: candidate.previousText,
    after: candidate.nextText
  }));

  if (locale === "en") {
    return [
      "Judge whether each candidate sentence is introducing upcoming visual content.",
      "It must be present tense, have a concrete visual target, and be an active speaker cue. Past review, hypothetical cases, vague transitions, music/noise/silence, and generic filler do not count.",
      "Return JSON only, no markdown, no explanation:",
      '[{"id":"cue-0","time":12.3,"keyword":"look here","score":0.9}]',
      `Only include candidates with score >= ${VISUAL_CUE_AI_SCORE_THRESHOLD}.`,
      JSON.stringify(compactCandidates)
    ].join("\n");
  }

  return [
    "判断每个候选句是否在“引出接下来的画面内容”。",
    "必须同时满足：当下时态、有具体指向对象、说话人主动引导。回顾过去、假设情景、泛泛过渡、音乐/噪音/静音、口头填充都不算。",
    "只返回 JSON，不要 Markdown，不要解释：",
    '[{"id":"cue-0","time":12.3,"keyword":"看这里","score":0.9}]',
    `只保留 score >= ${VISUAL_CUE_AI_SCORE_THRESHOLD} 的候选。`,
    JSON.stringify(compactCandidates)
  ].join("\n");
}

export function parseVisualCueJudgementResponse(response: string): VisualCueJudgement[] {
  const jsonText =
    response.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? response.trim();

  try {
    const parsed = JSON.parse(jsonText) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item): VisualCueJudgement | null => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const record = item as Record<string, unknown>;
        const score = Number(record.score);

        if (!Number.isFinite(score)) {
          return null;
        }

        return {
          id: typeof record.id === "string" ? record.id : undefined,
          time: typeof record.time === "number" ? record.time : undefined,
          keyword: typeof record.keyword === "string" ? record.keyword : undefined,
          score: clampScore(score)
        };
      })
      .filter((item): item is VisualCueJudgement => Boolean(item));
  } catch {
    return [];
  }
}

function ResultToolbar({
  targetId,
  labels,
  selectedText,
  activeFeedbackTargetId,
  responsePreference,
  onCopy,
  onTranslate,
  onLike,
  onDislike
}: {
  targetId: string;
  labels: ActionLabels;
  selectedText: string;
  activeFeedbackTargetId: string | null;
  responsePreference: ResponsePreference;
  onCopy: () => void;
  onTranslate: () => void;
  onLike: (targetId: string) => void;
  onDislike: (targetId: string) => void;
}) {
  const likedActive = isFeedbackPreferenceActive(
    {
      responsePreference,
      activeTargetId: activeFeedbackTargetId
    },
    targetId,
    "liked"
  );
  const dislikedActive = isFeedbackPreferenceActive(
    {
      responsePreference,
      activeTargetId: activeFeedbackTargetId
    },
    targetId,
    "disliked"
  );

  return (
    <div className="result-toolbar">
      <button
        type="button"
        className="toolbar-icon-button"
        title={labels.copy}
        aria-label={labels.copy}
        onClick={onCopy}
      >
        <CopyIcon />
      </button>
      <button
        type="button"
        className="toolbar-button"
        disabled={!selectedText}
        onClick={onTranslate}
      >
        {labels.translate}
      </button>
      <button
        type="button"
        className={likedActive ? "toolbar-icon-button active" : "toolbar-icon-button"}
        title={labels.like}
        aria-label={labels.like}
        onClick={() => onLike(targetId)}
      >
        <ThumbsUpIcon />
      </button>
      <button
        type="button"
        className={dislikedActive ? "toolbar-icon-button active" : "toolbar-icon-button"}
        title={labels.dislike}
        aria-label={labels.dislike}
        onClick={() => onDislike(targetId)}
      >
        <ThumbsDownIcon />
      </button>
    </div>
  );
}

function TimelineSummaryView({
  body,
  locale,
  labels,
  selectedText,
  activeFeedbackTargetId,
  responsePreference,
  onTextSelect,
  onCopy,
  onTranslateSelection,
  onLike,
  onDislike
}: {
  body: string;
  locale: Locale;
  labels: ActionLabels;
  selectedText: string;
  activeFeedbackTargetId: string | null;
  responsePreference: ResponsePreference;
  onTextSelect: () => void;
  onCopy: (content: string) => void;
  onTranslateSelection: () => void;
  onLike: (targetId: string) => void;
  onDislike: (targetId: string) => void;
}) {
  const parsed = parseTimelineSummary(body);
  const overviewLabel = locale === "zh" ? "整体概览" : "Overall Summary";
  const takeawayLabel = locale === "zh" ? "最终结论" : "Final Takeaway";

  if (parsed.segments.length === 0) {
    return (
      <div className="result-card-shell" onMouseUp={onTextSelect}>
        <MarkdownContent source={body} className="result-body markdown-content" />
        <ResultToolbar
          targetId="timeline-fallback"
          labels={labels}
          selectedText={selectedText}
          activeFeedbackTargetId={activeFeedbackTargetId}
          responsePreference={responsePreference}
          onCopy={() => onCopy(body)}
          onTranslate={onTranslateSelection}
          onLike={onLike}
          onDislike={onDislike}
        />
      </div>
    );
  }

  return (
    <div className="timeline-summary">
      {parsed.overview ? (
        <section className="timeline-block overview" onMouseUp={onTextSelect}>
          <div className="timeline-block-title">{overviewLabel}</div>
          <MarkdownContent
            source={parsed.overview}
            className="timeline-block-body markdown-content"
          />
          <ResultToolbar
            targetId="timeline-overview"
            labels={labels}
            selectedText={selectedText}
            activeFeedbackTargetId={activeFeedbackTargetId}
            responsePreference={responsePreference}
            onCopy={() => onCopy(parsed.overview)}
            onTranslate={onTranslateSelection}
            onLike={onLike}
            onDislike={onDislike}
          />
        </section>
      ) : null}

      <div className="timeline-list">
        {parsed.segments.map((segment, index) => {
          const cardText = `${segment.range}\n${segment.content}`;
          return (
            <section
              key={`${segment.range}-${segment.content}`}
              className="timeline-card"
              onMouseUp={onTextSelect}
            >
              <div className="timeline-range">{segment.range}</div>
              <MarkdownContent
                source={segment.content}
                className="timeline-card-body markdown-content"
              />
              <ResultToolbar
                targetId={`timeline-${index}-${segment.range}`}
                labels={labels}
                selectedText={selectedText}
                activeFeedbackTargetId={activeFeedbackTargetId}
                responsePreference={responsePreference}
                onCopy={() => onCopy(cardText)}
                onTranslate={onTranslateSelection}
                onLike={onLike}
                onDislike={onDislike}
              />
            </section>
          );
        })}
      </div>

      {parsed.takeaway ? (
        <section className="timeline-block takeaway" onMouseUp={onTextSelect}>
          <div className="timeline-block-title">{takeawayLabel}</div>
          <MarkdownContent
            source={parsed.takeaway}
            className="timeline-block-body markdown-content"
          />
          <ResultToolbar
            targetId="timeline-takeaway"
            labels={labels}
            selectedText={selectedText}
            activeFeedbackTargetId={activeFeedbackTargetId}
            responsePreference={responsePreference}
            onCopy={() => onCopy(parsed.takeaway)}
            onTranslate={onTranslateSelection}
            onLike={onLike}
            onDislike={onDislike}
          />
        </section>
      ) : null}
    </div>
  );
}

function MindMapLabelCard({
  label,
  compact = false
}: {
  label: string;
  compact?: boolean;
}) {
  const parts = splitMindMapLabel(label);

  return (
    <div className={compact ? "mindmap-label-card compact" : "mindmap-label-card"}>
      <MarkdownContent
        source={parts.title}
        inline
        className="mindmap-label-title markdown-content inline"
      />
      {parts.detail ? (
        <MarkdownContent
          source={parts.detail}
          inline
          className="mindmap-label-detail markdown-content inline"
        />
      ) : null}
    </div>
  );
}

function MindMapBranch({ node }: { node: MindMapNode }) {
  return (
    <li className="mindmap-branch">
      <MindMapLabelCard label={node.label} />
      {node.children.length > 0 ? (
        <ul className="mindmap-children">
          {node.children.map((child) => (
            <MindMapBranch key={child.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function MindMapSubpointList({ nodes }: { nodes: MindMapNode[] }) {
  if (nodes.length === 0) {
    return null;
  }

  return (
    <div className="mindmap-subpoint-list">
      {nodes.map((node) => (
        <div key={node.id} className="mindmap-subpoint-item">
          <MindMapLabelCard label={node.label} compact />
        </div>
      ))}
    </div>
  );
}

function MindMapTimeline({ nodes }: { nodes: MindMapNode[] }) {
  return (
    <div className="mindmap-timeline">
      {nodes.map((node, index) => (
        <article key={node.id} className="mindmap-timeline-card">
          <div className="mindmap-step-badge">{index + 1}</div>
          <div className="mindmap-timeline-content">
            <MindMapLabelCard label={node.label} />
            <MindMapSubpointList nodes={node.children} />
          </div>
        </article>
      ))}
    </div>
  );
}

function MindMapCluster({ nodes }: { nodes: MindMapNode[] }) {
  return (
    <div className="mindmap-cluster-grid">
      {nodes.map((node) => (
        <article key={node.id} className="mindmap-cluster-card">
          <MindMapLabelCard label={node.label} />
          <MindMapSubpointList nodes={node.children} />
        </article>
      ))}
    </div>
  );
}

function MindMapComparison({ nodes }: { nodes: MindMapNode[] }) {
  return (
    <div className="mindmap-comparison-grid">
      {nodes.map((node) => (
        <article key={node.id} className="mindmap-comparison-card">
          <MindMapLabelCard label={node.label} />
          {node.children.length > 0 ? (
            <ul className="mindmap-comparison-list">
              {node.children.map((child) => (
                <li key={child.id}>
                  <MindMapLabelCard label={child.label} compact />
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function MindMapCanvasView({ mindMap }: { mindMap: MindMapPayload }) {
  if (mindMap.type === "timeline") {
    return <MindMapTimeline nodes={mindMap.nodes} />;
  }

  if (mindMap.type === "cluster") {
    return <MindMapCluster nodes={mindMap.nodes} />;
  }

  if (mindMap.type === "comparison") {
    return <MindMapComparison nodes={mindMap.nodes} />;
  }

  return (
    <ul className="mindmap-tree">
      {mindMap.nodes.map((node) => (
        <MindMapBranch key={node.id} node={node} />
      ))}
    </ul>
  );
}

function formatMindMapType(type: MindMapLayout, locale: Locale) {
  const labels = {
    zh: {
      tree: "树状导图",
      timeline: "时间线导图",
      cluster: "主题簇导图",
      comparison: "对比导图"
    },
    en: {
      tree: "Tree Map",
      timeline: "Timeline Map",
      cluster: "Cluster Map",
      comparison: "Comparison Map"
    }
  } as const;

  return labels[locale][type];
}

function formatMindMapPreference(
  preference: MindMapLayoutPreference,
  locale: Locale,
  text: (typeof copy)["zh"] | (typeof copy)["en"]
) {
  if (preference === "auto") {
    return text.mindmapLayoutAuto;
  }

  return formatMindMapType(preference, locale);
}

function formatCompactMindMapPreference(preference: MindMapLayoutPreference, locale: Locale) {
  const labels = {
    zh: {
      auto: "自动",
      tree: "树状",
      timeline: "时间线",
      cluster: "主题簇",
      comparison: "对比"
    },
    en: {
      auto: "Auto",
      tree: "Tree",
      timeline: "Timeline",
      cluster: "Cluster",
      comparison: "Compare"
    }
  } as const;

  return labels[locale][preference];
}

function formatFrameTimestamp(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatFrameTimestampList(times: number[]) {
  return Array.from(new Set(times.map((time) => formatFrameTimestamp(time)))).join(", ");
}

function buildSampledFrameInstruction(frames: SampledVideoFrame[], locale: Locale) {
  if (frames.length === 0) {
    return "";
  }

  const timestamps = frames.map((frame) => formatFrameTimestamp(frame.time)).join(", ");

  if (locale === "en") {
    return [
      `The request includes ${frames.length} sampled frames from across the current video.`,
      `Frame timestamps: ${timestamps}.`,
      "Use these frames only as the final OCR supplement: first decide which frames contain readable learning content, OCR only those useful parts, deduplicate repeated OCR items, and use the result only to complete gaps in the audio/subtitle-based mind map."
    ].join("\n");
  }

  return [
    `本次请求已经从当前视频自动抽取 ${frames.length} 张画面。`,
    `抽帧时间点：${timestamps}。`,
    "这些画面只作为最后的 OCR 补充：请先判断哪些画面有可读学习内容，只 OCR 有用部分，对重复 OCR 结果去重，并且只用来补全基于语音/字幕生成的思维导图。"
  ].join("\n");
}

export function buildDetailedSummaryVisualCueInstruction(
  cues: VisualCue[],
  frames: SampledVideoFrame[],
  denseWarnings: DenseKeywordWarning[],
  locale: Locale
) {
  if (cues.length === 0 || frames.length === 0) {
    return locale === "en"
      ? "No visual cue keywords were detected, so do not perform frame/image analysis. Build the detailed summary only from the speech transcript and subtitles."
      : "本次没有检测到视觉提示关键词，因此不需要进行画面分析。请只根据语音转写和字幕生成细节摘要。";
  }

  const cueLines = cues.map((cue) => {
    const sampleTimes = cue.sampleTimes?.length
      ? formatFrameTimestampList(cue.sampleTimes)
      : cue.captureTime !== undefined
        ? formatFrameTimestamp(cue.captureTime)
        : "";
    const confidence =
      cue.confidence !== undefined ? ` ${Math.round(cue.confidence * 100)}%` : "";

    if (locale === "en") {
      return `- Cue ends at ${formatFrameTimestamp(cue.endTime)}${confidence}: ${cue.text} | candidate frames: ${sampleTimes}`;
    }

    return `- 视觉提示关键词结束于 ${formatFrameTimestamp(cue.endTime)}${confidence}：${cue.text} | 候选抽帧：${sampleTimes}`;
  });
  const denseLines = denseWarnings.map((warning) =>
    locale === "en"
      ? `- Dense keyword window ${formatFrameTimestamp(warning.startTime)}-${formatFrameTimestamp(warning.endTime)}: ${warning.count} cue keywords, sampled uniformly by time.`
      : `- 关键词密集段 ${formatFrameTimestamp(warning.startTime)}-${formatFrameTimestamp(warning.endTime)}：共 ${warning.count} 个关键词，已按时间均匀抽帧。`
  );
  const frameTimestamps = formatFrameTimestampList(frames.map((frame) => frame.time));

  if (locale === "en") {
    return [
      "Visual cue keywords were detected in the speech transcript, and candidate frames are attached.",
      `Attached frame timestamps: ${frameTimestamps}.`,
      "Cue plan:",
      ...cueLines,
      denseLines.length > 0 ? "Dense keyword notes:" : "",
      ...denseLines,
      "When writing the detailed summary, combine speech transcript first, subtitles second, and these frames third. Do not simply trust every frame: choose the clearest and most informative frame around each cue, ignore transition/blur frames, skip silence/music/noise-only segments, and do not invent visual content for segments without visual cues."
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "本次在语音转写里检测到视觉提示关键词，并已附带候选抽帧画面。",
    `已附带画面时间点：${frameTimestamps}。`,
    "视觉提示关键词计划：",
    ...cueLines,
    denseLines.length > 0 ? "关键词密集说明：" : "",
    ...denseLines,
    "生成细节摘要时，请以语音转写为主、字幕为辅、这些画面为第三层补充。不要简单相信每一帧：请围绕每个关键词挑选最清晰、信息量最大的画面，忽略转场/模糊帧，跳过静音、音乐、噪音段；没有视觉关键词的时间段不要编造画面内容。"
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildMindMapVisualCueInstruction(
  cues: VisualCue[],
  frames: SampledVideoFrame[],
  denseWarnings: DenseKeywordWarning[],
  locale: Locale
) {
  if (cues.length === 0 || frames.length === 0) {
    return locale === "en"
      ? "No visual cue keywords were detected, so do not perform frame OCR for the mind map. Build the mind map from the speech transcript first and subtitles second."
      : "本次没有检测到视觉提示关键词，因此思维导图不进行画面 OCR。请优先根据语音转写生成，字幕只作为辅助。";
  }

  const cueLines = cues.map((cue) => {
    const sampleTimes = cue.sampleTimes?.length
      ? formatFrameTimestampList(cue.sampleTimes)
      : cue.captureTime !== undefined
        ? formatFrameTimestamp(cue.captureTime)
        : "";
    const confidence =
      cue.confidence !== undefined ? ` ${Math.round(cue.confidence * 100)}%` : "";

    if (locale === "en") {
      return `- Cue ends at ${formatFrameTimestamp(cue.endTime)}${confidence}: ${cue.text} | frame: ${sampleTimes}`;
    }

    return `- 视觉提示关键词结束于 ${formatFrameTimestamp(cue.endTime)}${confidence}：${cue.text} | 抽帧：${sampleTimes}`;
  });
  const denseLines = denseWarnings.map((warning) =>
    locale === "en"
      ? `- Dense keyword window ${formatFrameTimestamp(warning.startTime)}-${formatFrameTimestamp(warning.endTime)}: ${warning.count} cue keywords, sampled uniformly by time.`
      : `- 关键词密集段 ${formatFrameTimestamp(warning.startTime)}-${formatFrameTimestamp(warning.endTime)}：共 ${warning.count} 个关键词，已按时间均匀抽帧。`
  );
  const frameTimestamps = formatFrameTimestampList(frames.map((frame) => frame.time));

  if (locale === "en") {
    return [
      "Mind map visual supplement: use the same optimized visual-cue funnel as Detailed Summary.",
      `Attached frame timestamps: ${frameTimestamps}.`,
      "Only OCR frames that clearly contain learning content. Use OCR as a final supplement after the speech transcript and subtitles; do not let visual OCR replace the transcript structure.",
      "Cue plan:",
      ...cueLines,
      denseLines.length > 0 ? "Dense keyword notes:" : "",
      ...denseLines
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "思维导图视觉补充：使用与细节摘要相同的三层关键词漏斗。",
    `已附带画面时间点：${frameTimestamps}。`,
    "请只对明显包含学习内容的画面做 OCR。OCR 只作为语音转写和字幕之后的最终补充，不要让画面 OCR 取代语音转写的结构。",
    "视觉提示关键词计划：",
    ...cueLines,
    denseLines.length > 0 ? "关键词密集说明：" : "",
    ...denseLines
  ]
    .filter(Boolean)
    .join("\n");
}

function buildMindMapLayoutInstruction(preference: MindMapLayoutPreference, locale: Locale) {
  if (preference === "auto") {
    return "";
  }

  if (locale === "zh") {
    return `这次请不要自动判断导图类型，直接使用 ${preference} 作为思维导图类型输出。`;
  }

  return `Do not auto-select the layout this time. Use ${preference} as the mind map layout type.`;
}

function buildMindMapReadableText(mindMap: MindMapPayload, locale: Locale) {
  const lines = [mindMap.title];

  if (mindMap.summary) {
    lines.push(
      locale === "zh" ? `概览：${mindMap.summary}` : `Summary: ${mindMap.summary}`
    );
  }

  const walk = (nodes: MindMapNode[], depth = 0) => {
    nodes.forEach((node, index) => {
      const indent = "  ".repeat(depth);
      const marker = depth === 0 ? `${index + 1}.` : "-";
      const parts = splitMindMapLabel(node.label);
      const line = parts.detail
        ? `${indent}${marker} ${parts.title}：${parts.detail}`
        : `${indent}${marker} ${parts.title}`;

      lines.push(line);

      if (node.children.length > 0) {
        walk(node.children, depth + 1);
      }
    });
  };

  walk(mindMap.nodes);

  return lines.join("\n");
}

function MindMapReadableSection({
  mindMap,
  locale
}: {
  mindMap: MindMapPayload;
  locale: Locale;
}) {
  return (
    <div className="mindmap-readable-list">
      {mindMap.nodes.map((node, index) => (
        <article key={node.id} className="mindmap-readable-card">
          <div className="mindmap-readable-index">{index + 1}</div>
          <div className="mindmap-readable-content">
            <MindMapLabelCard label={node.label} />
            <MindMapSubpointList nodes={node.children} />
          </div>
        </article>
      ))}
      {mindMap.nodes.length === 0 ? (
        <div className="mindmap-empty">
          {locale === "zh" ? "还没有可读结构。" : "No readable structure yet."}
        </div>
      ) : null}
    </div>
  );
}

function sanitizeDownloadName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").trim() || "mind-map";
}

function createSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function truncateHistoryText(source: string) {
  return source.length > 72 ? `${source.slice(0, 72)}...` : source;
}

function isStarterAssistantContent(content: string) {
  const normalized = content.trim();

  return (
    normalized === copy.zh.initialAssistant ||
    normalized === copy.en.initialAssistant ||
    normalized === copy.zh.restartedAssistant ||
    normalized === copy.en.restartedAssistant ||
    normalized.startsWith("先生成摘要") ||
    normalized.startsWith("先生成快速摘要") ||
    normalized.startsWith("Generate a summary first") ||
    normalized.startsWith("Generate a Quick Summary") ||
    normalized.startsWith("新的对话已经开始") ||
    normalized.startsWith("A new conversation has started")
  );
}

function isDefaultResultBody(content: string) {
  const normalized = content.trim();

  return (
    normalized === copy.zh.resultBody ||
    normalized === copy.en.resultBody ||
    normalized.startsWith("点击“摘要”后") ||
    normalized.startsWith("可以先生成快速摘要") ||
    normalized.startsWith("After you click Summary") ||
    normalized.startsWith("Use Quick Summary")
  );
}

export function buildHistorySessionTitle(session: HistorySession, locale: Locale) {
  const videoTitle = session.videoTitle.trim();

  if (videoTitle) {
    return truncateHistoryText(videoTitle);
  }

  const resultTitle = session.resultTitle.trim();

  if (resultTitle && resultTitle !== "结果" && resultTitle !== "Result") {
    return truncateHistoryText(resultTitle);
  }

  return locale === "zh" ? "未命名会话" : "Untitled session";
}

export function buildHistorySessionPreview(session: HistorySession, locale: Locale) {
  const userMessage = session.chatHistory.find((message) => message.role === "user")?.content.trim();
  const assistantMessage = session.chatHistory.find((message) => {
    const content = message.content.trim();
    return message.role === "assistant" && content && !isStarterAssistantContent(content);
  })?.content.trim();
  const resultBody = session.resultBody.trim();
  const resultPreview = resultBody && !isDefaultResultBody(resultBody) ? resultBody : "";
  const source =
    userMessage ||
    resultPreview ||
    assistantMessage ||
    (locale === "zh" ? "暂无内容" : "No content yet");

  return truncateHistoryText(source);
}

export function isMeaningfulHistorySession(session: HistorySession) {
  const hasMeaningfulResult = Boolean(
    session.resultBody.trim() && !isDefaultResultBody(session.resultBody.trim())
  );
  const hasMeaningfulMessage = session.chatHistory.some((message) => {
    const content = message.content.trim();

    if (!content) {
      return false;
    }

    return message.role === "user" || !isStarterAssistantContent(content);
  });

  return hasMeaningfulResult || hasMeaningfulMessage;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("assistant");
  const [locale, setLocale] = useState<Locale>("zh");
  const [pageContext, setPageContext] = useState<PageContext>(demoContext);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>(getDefaultProviderConfig);
  const [skills, setSkills] = useState<CustomSkill[]>(initialSkills);
  const [question, setQuestion] = useState<string>(copy.zh.initialQuestion);
  const [resultTitle, setResultTitle] = useState<string>(copy.zh.resultTitle);
  const [resultBody, setResultBody] = useState<string>(copy.zh.resultBody);
  const [resultCollapsed, setResultCollapsed] = useState(false);
  const [mindMapBody, setMindMapBody] = useState<string>(getMindmapSeed("zh"));
  const [status, setStatus] = useState<string>(copy.zh.statuses.ready);
  const [loadingMode, setLoadingMode] = useState<LoadingMode>(null);
  const [chatActive, setChatActive] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [mindMapLayoutPreference, setMindMapLayoutPreference] =
    useState<MindMapLayoutPreference>("auto");
  const [mindMapLayoutMenuOpen, setMindMapLayoutMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [translationDirection, setTranslationDirection] =
    useState<TranslationDirection>("en-to-zh");
  const [selectedText, setSelectedText] = useState("");
  const [selectionTranslation, setSelectionTranslation] = useState("");
  const [responsePreference, setResponsePreference] = useState<ResponsePreference>(null);
  const [activeFeedbackTargetId, setActiveFeedbackTargetId] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => createSessionId());
  const [historySessions, setHistorySessions] = useState<HistorySession[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: copy.zh.initialAssistant
    }
  ]);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const wordInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const mindmapCanvasRef = useRef<HTMLDivElement>(null);
  const activeSkillCount = skills.filter((skill) => skill.enabled).length;
  const enabledSkills = useMemo(() => skills.filter((skill) => skill.enabled), [skills]);
  const parsedMindMap = useMemo<MindMapPayload>(
    () => parseMindMapPayload(mindMapBody),
    [mindMapBody]
  );
  const mindMapDisplaySource = useMemo(
    () => formatMindMapSourceForDisplay(mindMapBody),
    [mindMapBody]
  );
  const mindMapNodes = parsedMindMap.nodes;
  const filteredHistorySessions = useMemo(() => {
    const meaningfulSessions = historySessions.filter(isMeaningfulHistorySession);
    const normalizedQuery = historyQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return meaningfulSessions;
    }

    return meaningfulSessions.filter((session) => {
      const haystack = [
        session.videoTitle,
        session.resultTitle,
        session.resultBody,
        ...session.chatHistory.map((message) => message.content)
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [historyQuery, historySessions]);
  const isLoading = loadingMode !== null;
  const isLocalPreview =
    globalThis.location?.origin === "http://localhost:3001" ||
    globalThis.location?.origin === "http://127.0.0.1:3001";
  const text = copy[locale];
  const extensionRuntime = globalThis.chrome?.runtime;
  const isTimelineSummaryTitle = shouldRenderTimelineSummaryCards(resultTitle);
  const actionLabels: ActionLabels = {
    copy: text.copy,
    translate: text.translate,
    like: text.like,
    dislike: text.dislike
  };

  useEffect(() => {
    const storedProvider = globalThis.localStorage?.getItem(PROVIDER_STORAGE_KEY);
    const storedSkills = globalThis.localStorage?.getItem(SKILLS_STORAGE_KEY);
    const storedLocale = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    const storedPreference = globalThis.localStorage?.getItem(RESPONSE_PREFERENCE_STORAGE_KEY);
    const storedPrompt = globalThis.localStorage?.getItem(CUSTOM_PROMPT_STORAGE_KEY);
    const storedHistory = globalThis.localStorage?.getItem(HISTORY_SESSIONS_STORAGE_KEY);

    if (storedProvider) {
      setProviderConfig(normalizeProviderConfig(JSON.parse(storedProvider) as ProviderConfig));
    }

    if (storedSkills) {
      setSkills(JSON.parse(storedSkills) as CustomSkill[]);
    }

    if (storedLocale === "zh" || storedLocale === "en") {
      setLocale(storedLocale);
    }

    if (storedPreference === "liked" || storedPreference === "disliked") {
      setResponsePreference(storedPreference);
    }

    if (storedPrompt) {
      setCustomPrompt(storedPrompt);
    }

    if (storedHistory) {
      setHistorySessions(JSON.parse(storedHistory) as HistorySession[]);
    }
  }, []);

  useEffect(() => {
    globalThis.localStorage?.setItem(PROVIDER_STORAGE_KEY, JSON.stringify(providerConfig));
  }, [providerConfig]);

  useEffect(() => {
    globalThis.localStorage?.setItem(SKILLS_STORAGE_KEY, JSON.stringify(skills));
  }, [skills]);

  useEffect(() => {
    globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  useEffect(() => {
    if (responsePreference) {
      globalThis.localStorage?.setItem(RESPONSE_PREFERENCE_STORAGE_KEY, responsePreference);
      return;
    }

    globalThis.localStorage?.removeItem(RESPONSE_PREFERENCE_STORAGE_KEY);
  }, [responsePreference]);

  useEffect(() => {
    globalThis.localStorage?.setItem(CUSTOM_PROMPT_STORAGE_KEY, customPrompt);
  }, [customPrompt]);

  useEffect(() => {
    globalThis.localStorage?.setItem(HISTORY_SESSIONS_STORAGE_KEY, JSON.stringify(historySessions));
  }, [historySessions]);

  useEffect(() => {
    setQuestion((current) =>
      current.trim().length > 0 ? current : copy[locale].initialQuestion
    );
  }, [locale]);

  useEffect(() => {
    setTranslationDirection(locale === "zh" ? "en-to-zh" : "zh-to-en");
  }, [locale]);

  useEffect(() => {
    setResultTitle((current) => translateResultTitle(current, locale));

    setResultBody((current) => {
      if (current === copy.zh.resultBody || current === copy.en.resultBody) {
        return copy[locale].resultBody;
      }

      return current;
    });
  }, [locale]);

  useEffect(() => {
    setStatus((current) => {
      const replacements: Array<[string, string]> = [
        [copy.zh.statuses.ready, copy.en.statuses.ready],
        [copy.zh.statuses.summary, copy.en.statuses.summary],
        [copy.zh.statuses.qa, copy.en.statuses.qa],
        [copy.zh.statuses.frame, copy.en.statuses.frame],
        [copy.zh.statuses.done, copy.en.statuses.done],
        [copy.zh.statuses.failed, copy.en.statuses.failed],
        [copy.zh.statuses.mindmap, copy.en.statuses.mindmap],
        [copy.zh.statuses.mindmapDone, copy.en.statuses.mindmapDone],
        [copy.zh.statuses.mindmapFailed, copy.en.statuses.mindmapFailed],
        [copy.zh.statuses.transcribing, copy.en.statuses.transcribing],
        [copy.zh.statuses.stop, copy.en.statuses.stop],
        [copy.zh.statuses.start, copy.en.statuses.start],
        [copy.zh.copied, copy.en.copied],
        [copy.zh.mindmapExported, copy.en.mindmapExported],
        [copy.zh.mindmapExportFailed, copy.en.mindmapExportFailed],
        [copy.zh.translationLoading, copy.en.translationLoading],
        [copy.zh.translationEmpty, copy.en.translationEmpty],
        [copy.zh.preferenceLiked, copy.en.preferenceLiked],
        [copy.zh.preferenceDisliked, copy.en.preferenceDisliked],
        [copy.zh.preferenceCleared, copy.en.preferenceCleared]
      ];

      for (const [zhValue, enValue] of replacements) {
        if (current === zhValue || current === enValue) {
          return locale === "zh" ? zhValue : enValue;
        }
      }

      return current;
    });
  }, [locale]);

  useEffect(() => {
    setChatHistory((currentHistory) =>
      currentHistory.map((message) => {
        if (message.role !== "assistant") {
          return message;
        }

        if (
          message.content === copy.zh.initialAssistant ||
          message.content === copy.en.initialAssistant
        ) {
          return {
            ...message,
            content: copy[locale].initialAssistant
          };
        }

        if (
          message.content === copy.zh.stoppedAssistant ||
          message.content === copy.en.stoppedAssistant
        ) {
          return {
            ...message,
            content: copy[locale].stoppedAssistant
          };
        }

        if (
          message.content === copy.zh.restartedAssistant ||
          message.content === copy.en.restartedAssistant
        ) {
          return {
            ...message,
            content: copy[locale].restartedAssistant
          };
        }

        return message;
      })
    );
  }, [locale]);

  useEffect(() => {
    const now = Date.now();
    const nextSession: HistorySession = {
      id: currentSessionId,
      createdAt: now,
      updatedAt: now,
      locale,
      videoTitle: pageContext.title,
      resultTitle,
      resultBody,
      chatHistory
    };

    setHistorySessions((currentSessions) => {
      const existing = currentSessions.find((session) => session.id === currentSessionId);
      const merged: HistorySession = existing
        ? {
            ...existing,
            updatedAt: now,
            locale,
            videoTitle: pageContext.title,
            resultTitle,
            resultBody,
            chatHistory
          }
        : nextSession;

      return [merged, ...currentSessions.filter((session) => session.id !== currentSessionId)].slice(
        0,
        30
      );
    });
  }, [currentSessionId, locale, pageContext.title, resultTitle, resultBody, chatHistory]);

  async function extractWordContent(file: File) {
    const lowerName = file.name.toLowerCase();

    if (!lowerName.endsWith(".docx")) {
      return text.wordDocOnly;
    }

    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const documentXml = await zip.file("word/document.xml")?.async("string");

    if (!documentXml) {
      return text.wordDocUnreadable;
    }

    const extractedText = extractDocxTextFromXml(documentXml);
    return extractedText || text.wordDocEmpty;
  }

  async function fetchLivePageContext() {
    if (isLocalPreview || !extensionRuntime?.id) {
      setPageContext(demoContext);
      return demoContext;
    }

    const response = (await extensionRuntime.sendMessage({
      type: "GET_BILIBILI_PAGE_CONTEXT"
    })) as RuntimePageContextResponse;

    if (!response?.ok || !response.context) {
      throw new Error(response?.error || "无法读取当前 B站 视频页面内容。");
    }

    setPageContext(response.context);
    return response.context;
  }

  async function fetchLiveFrame() {
    if (isLocalPreview || !extensionRuntime?.id) {
      return {
        context: demoContext,
        imageBase64: null,
        paused: false
      };
    }

    const response = (await extensionRuntime.sendMessage({
      type: "CAPTURE_BILIBILI_FRAME"
    })) as RuntimeFrameResponse;

    if (!response?.ok) {
      throw new Error(response?.error || "无法抓取当前视频画面。");
    }

    if (response.context) {
      setPageContext(response.context);
    }

    return {
      context: response.context ?? pageContext,
      imageBase64: response.imageBase64 ?? null,
      paused: response.paused ?? false
    };
  }

  async function fetchLiveFrameSeries(sampleTimes?: number[]) {
    if (isLocalPreview || !extensionRuntime?.id) {
      return {
        context: demoContext,
        frames: [] as SampledVideoFrame[],
        paused: false
      };
    }

    const response = (await extensionRuntime.sendMessage({
      type: "CAPTURE_BILIBILI_FRAME_SERIES",
      sampleTimes
    })) as RuntimeFrameSeriesResponse;

    if (!response?.ok) {
      throw new Error(response?.error || "无法自动抽取当前视频画面。");
    }

    if (response.context) {
      setPageContext(response.context);
    }

    return {
      context: response.context ?? pageContext,
      frames: response.frames ?? [],
      paused: response.paused ?? false
    };
  }

  async function fetchLiveAudioTranscription() {
    if (isLocalPreview || !extensionRuntime?.id) {
      return {
        context: demoContext,
        transcriptText: demoContext.transcriptText ?? demoContext.subtitleText ?? "",
        sourceUrl: ""
      };
    }

    const response = (await extensionRuntime.sendMessage({
      type: "TRANSCRIBE_BILIBILI_AUDIO",
      providerConfig
    })) as RuntimeAudioTranscriptionResponse;

    if (!response?.ok || !response.transcriptText?.trim()) {
      throw new Error(response?.error || text.audioUnavailable);
    }

    if (response.context) {
      setPageContext(response.context);
    }

    return {
      context: response.context ?? pageContext,
      transcriptText: response.transcriptText,
      sourceUrl: response.sourceUrl ?? ""
    };
  }

  function buildPreferenceInstruction() {
    if (responsePreference === "liked") {
      return locale === "zh"
        ? "请延续我点赞的回答风格：更清楚、更贴近我的预期、结构更稳定。"
        : "Please continue in the style I liked: clearer, closer to my preference, and more structured.";
    }

    if (responsePreference === "disliked") {
      return locale === "zh"
        ? "请避免我点踩的回答风格：减少啰嗦或偏题，回答更直接、更简洁。"
        : "Please avoid the style I disliked: reduce rambling or drift, and answer more directly and concisely.";
    }

    return "";
  }

  function mergeInstruction(baseInstruction?: string) {
    const parts = [baseInstruction, customPrompt, buildPreferenceInstruction()].filter(
      (item): item is string => Boolean(item?.trim())
    );

    return parts.length > 0 ? parts.join("\n\n") : undefined;
  }

  function ensureSupportedVideoForAnalysis(context: PageContext) {
    if (!isSupportedVideoDuration(context.duration)) {
      throw new Error(text.videoTooLong);
    }
  }

  function handleSelectionCapture() {
    const nextSelection = globalThis.getSelection?.()?.toString().trim() ?? "";

    if (nextSelection) {
      setSelectedText(nextSelection);
    }
  }

  async function handleCopy(content: string) {
    await navigator.clipboard.writeText(content);
    setStatus(text.copied);
  }

  function handleLike(targetId: string) {
    const nextSelection = getNextFeedbackSelection(
      {
        responsePreference,
        activeTargetId: activeFeedbackTargetId
      },
      targetId,
      "liked"
    );

    setResponsePreference(nextSelection.responsePreference);
    setActiveFeedbackTargetId(nextSelection.activeTargetId);
    setStatus(nextSelection.responsePreference ? text.preferenceLiked : text.preferenceCleared);
  }

  function handleDislike(targetId: string) {
    const nextSelection = getNextFeedbackSelection(
      {
        responsePreference,
        activeTargetId: activeFeedbackTargetId
      },
      targetId,
      "disliked"
    );

    setResponsePreference(nextSelection.responsePreference);
    setActiveFeedbackTargetId(nextSelection.activeTargetId);
    setStatus(
      nextSelection.responsePreference ? text.preferenceDisliked : text.preferenceCleared
    );
  }

  useEffect(() => {
    if (isLocalPreview || !extensionRuntime?.id) {
      return;
    }

    void fetchLivePageContext().catch(() => {
      return;
    });

    const interval = window.setInterval(() => {
      void fetchLivePageContext().catch(() => {
        return;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [extensionRuntime?.id, isLocalPreview]);

  async function requestAnalyze(
    mode: "quick-summary" | "summary" | "qa" | "frame-analysis" | "mindmap",
    nextQuestion?: string,
    imageBase64?: string,
    contextOverride?: PageContext,
    conversationHistory?: ChatHistoryMessage[],
    imageBase64List?: string[]
  ) {
    const context = contextOverride ?? pageContext;

    if (isLocalPreview) {
      const response = await fetch("/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mode,
          context,
          locale,
          activeSkills: enabledSkills,
          question: nextQuestion,
          conversationHistory,
          frameImageBase64: imageBase64,
          frameImageBase64List: imageBase64List,
          providerConfig
        })
      });

      return (await response.json()) as AnalyzeResponse;
    }

    return requestProviderAnalysis({
      mode,
      context,
      locale,
      activeSkills: enabledSkills,
      question: nextQuestion,
      imageBase64,
      imageBase64List,
      providerConfig,
      conversationHistory
    });
  }

  async function requestVisualCueJudgements(
    candidates: VisualCueCandidate[],
    contextOverride: PageContext
  ) {
    if (candidates.length === 0 || !providerConfig.apiKey.trim()) {
      return undefined;
    }

    const prompt = buildVisualCueJudgementPrompt(candidates, locale);
    const judgementContext: PageContext = {
      ...contextOverride,
      description: "",
      transcriptText: "",
      subtitleText: ""
    };

    try {
      if (isLocalPreview) {
        const response = await fetch("/analyze", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            mode: "qa",
            context: judgementContext,
            locale,
            activeSkills: [],
            question: prompt,
            providerConfig
          })
        });
        const result = (await response.json()) as AnalyzeResponse;
        return parseVisualCueJudgementResponse(result.body);
      }

      const result = await requestProviderAnalysis({
        mode: "qa",
        context: judgementContext,
        locale,
        activeSkills: [],
        question: prompt,
        providerConfig
      });
      return parseVisualCueJudgementResponse(result.body);
    } catch {
      return undefined;
    }
  }

  async function callAnalyze(
    mode: "quick-summary" | "summary" | "qa" | "frame-analysis",
    nextQuestion?: string,
    imageBase64?: string,
    contextOverride?: PageContext,
    conversationHistory?: ChatHistoryMessage[],
    imageBase64List?: string[]
  ) {
    const context = contextOverride ?? pageContext;
    setLoadingMode(mode);
    setStatus(
      mode === "quick-summary"
        ? text.statuses.quickSummary
        : mode === "summary"
          ? text.statuses.detailedSummary
        : mode === "qa"
          ? text.statuses.qa
          : text.statuses.frame
    );

    try {
      if (mode === "quick-summary" || mode === "summary") {
        ensureSupportedVideoForAnalysis(context);
      }

      const result = await requestAnalyze(
        mode,
        nextQuestion,
        imageBase64,
        context,
        conversationHistory,
        imageBase64List
      );

      setResultTitle(translateResultTitle(result.title, locale));
      setResultBody(result.body);

      if (mode === "qa") {
        setChatHistory((currentHistory) => [
          ...currentHistory,
          { role: "assistant", content: result.body }
        ]);
      }

      setStatus(text.statuses.done);
    } catch (error) {
      const message = error instanceof Error ? error.message : text.requestFailed;
      setResultTitle(locale === "zh" ? "请求失败" : "Request Failed");
      setResultBody(message);
      setStatus(text.statuses.failed);

      if (mode === "qa") {
        setChatHistory((currentHistory) => [
          ...currentHistory,
          { role: "assistant", content: message }
        ]);
      }
    } finally {
      setLoadingMode(null);
    }
  }

  async function handleMindMapGenerate() {
    setLoadingMode("mindmap");
    setStatus(text.statuses.mindmap);

    try {
      let liveContext = await fetchLivePageContext().catch(() => pageContext);
      ensureSupportedVideoForAnalysis(liveContext);
      let transcriptText = "";
      let fallbackInstruction = "";
      let mindMapImageBase64: string | undefined;
      let mindMapImageBase64List: string[] | undefined;
      let sampledFrameInstruction = "";

      setStatus(text.statuses.transcribing);

      try {
        const transcription = await fetchLiveAudioTranscription();
        liveContext = transcription.context;
        transcriptText = transcription.transcriptText;
      } catch (error) {
        const fallbackTranscript =
          liveContext.transcriptText?.trim() || liveContext.subtitleText?.trim() || "";

        if (!fallbackTranscript) {
          throw error;
        }

        transcriptText = fallbackTranscript;
        fallbackInstruction = text.audioFallbackInstruction;
      }

      if (providerConfig.visionEnabled) {
        const visualCueCandidates = buildVisualCueCandidates(transcriptText, liveContext.duration);
        setStatus(text.statuses.judgingVisualCues);
        const visualCueJudgements = await requestVisualCueJudgements(
          visualCueCandidates,
          liveContext
        );
        const visualCuePlan = buildVisualCueFramePlan(
          transcriptText,
          liveContext.duration,
          visualCueJudgements
        );

        if (visualCuePlan.frameTimes.length > 0) {
          setStatus(text.statuses.samplingFrames);
          const frameSeries = await fetchLiveFrameSeries(visualCuePlan.frameTimes).catch(
            () => null
          );

          if (frameSeries?.frames.length) {
            liveContext = frameSeries.context;
            mindMapImageBase64List = frameSeries.frames.map((frame) => frame.imageBase64);
            sampledFrameInstruction = buildMindMapVisualCueInstruction(
              visualCuePlan.cues,
              frameSeries.frames,
              visualCuePlan.denseWarnings,
              locale
            );
          } else {
            sampledFrameInstruction =
              locale === "zh"
                ? "检测到视觉提示关键词，但自动抽帧没有返回可用画面。思维导图请只根据语音转写和字幕生成，不要编造画面 OCR 内容。"
                : "Visual cue keywords were detected, but automatic frame capture returned no usable frames. Build the mind map only from the speech transcript and subtitles, and do not invent OCR content.";
          }
        } else {
          sampledFrameInstruction = buildMindMapVisualCueInstruction([], [], [], locale);
        }
      } else {
        sampledFrameInstruction =
          locale === "zh"
            ? "当前 API 配置未启用视觉能力，因此思维导图不进行画面 OCR。请优先根据语音转写生成，字幕只作为辅助。"
            : "Vision is disabled in API settings, so do not perform frame OCR for the mind map. Use the speech transcript first and subtitles second.";
      }

      if (!transcriptText.trim() && !mindMapImageBase64List?.length && !mindMapImageBase64) {
        throw new Error(text.audioUnavailable);
      }

      const layoutInstruction = buildMindMapLayoutInstruction(mindMapLayoutPreference, locale);
      const mindMapInstruction = [
        text.mindmapQuestion,
        text.mindmapAudioInstruction,
        fallbackInstruction,
        sampledFrameInstruction,
        layoutInstruction
      ]
        .filter(Boolean)
        .join("\n\n");
      const result = await requestAnalyze(
        "mindmap",
        mergeInstruction(mindMapInstruction),
        mindMapImageBase64,
        {
          ...liveContext,
          transcriptText
        },
        undefined,
        mindMapImageBase64List
      );
      setMindMapBody(result.body);
      setStatus(text.statuses.mindmapDone);
    } catch (error) {
      const message = error instanceof Error ? error.message : text.requestFailed;
      setMindMapBody(message);
      setStatus(text.statuses.mindmapFailed);
    } finally {
      setLoadingMode(null);
    }
  }

  async function handleMindMapExport() {
    if (!mindmapCanvasRef.current || mindMapNodes.length === 0) {
      setStatus(text.mindmapExportFailed);
      return;
    }

    try {
      const dataUrl = await toPng(mindmapCanvasRef.current, {
        cacheBust: true,
        backgroundColor: "#f8fbff",
        pixelRatio: 2
      });

      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `${sanitizeDownloadName(pageContext.title)}-mindmap.png`;
      link.click();
      setStatus(text.mindmapExported);
    } catch {
      setStatus(text.mindmapExportFailed);
    }
  }

  function handleInstallSkill(rawSkill: string) {
    const parsed = installSkill(JSON.parse(rawSkill) as unknown);
    setSkills((currentSkills) => {
      const filtered = currentSkills.filter((skill) => skill.id !== parsed.id);
      return [...filtered, parsed];
    });
  }

  function handleToggleSkill(skillId: string, enabled: boolean) {
    setSkills((currentSkills) =>
      currentSkills.map((skill) =>
        skill.id === skillId ? toggleSkill(skill, enabled) : skill
      )
    );
  }

  async function handleAttachmentPick(
    kind: AttachmentKind,
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const item: AttachmentItem = {
      id: `${kind}-${Date.now()}`,
      kind,
      name: file.name,
      sizeLabel: formatFileSize(file.size)
    };

    if (kind === "image") {
      const dataUrl = await readFileAsDataUrl(file);
      item.previewUrl = dataUrl;
      item.base64 = dataUrl;
    }

    if (kind === "word") {
      item.content = await extractWordContent(file);
    }

    if (kind === "code") {
      item.content = await readFileAsText(file);
    }

    setAttachments((currentAttachments) => [...currentAttachments, item]);
    setAttachmentMenuOpen(false);
    setStatus(text.attachmentAdded(text.attachmentKinds[kind]));
    event.target.value = "";
  }

  function removeAttachment(id: string) {
    setAttachments((currentAttachments) =>
      currentAttachments.filter((attachment) => attachment.id !== id)
    );
  }

  function handleLoadHistorySession(session: HistorySession) {
    setCurrentSessionId(session.id);
    setLocale(session.locale);
    setChatHistory(session.chatHistory);
    setResultTitle(session.resultTitle);
    setResultBody(session.resultBody);
    setHistoryOpen(false);
    setHistoryQuery("");
    setStatus(text.statuses.ready);
    setAttachments([]);
  }

  function handleDeleteHistorySession(sessionId: string) {
    setHistorySessions((currentSessions) =>
      removeHistorySessionById(currentSessions, sessionId)
    );
    setStatus(text.historyDeleted);
  }

  function handleToggleChat() {
    if (chatActive) {
      setChatActive(false);
      setStatus(text.statuses.stop);
      setChatHistory((currentHistory) => [
        ...currentHistory,
        {
          role: "assistant",
          content: text.stoppedAssistant
        }
      ]);
      return;
    }

    setChatActive(true);
    setCurrentSessionId(createSessionId());
    setQuestion("");
    setAttachments([]);
    setStatus(text.statuses.start);
    setChatHistory([
      {
        role: "assistant",
        content: text.restartedAssistant
      }
    ]);
  }

  async function handleSummary() {
    const liveContext = await fetchLivePageContext().catch(() => pageContext);
    const attachmentPrompt =
      attachments.length > 0
        ? buildAttachmentPrompt(text.summaryAttachment, attachments)
        : undefined;
    const firstImage = attachments.find((attachment) => attachment.kind === "image");
    await callAnalyze(
      "quick-summary",
      mergeInstruction(attachmentPrompt),
      firstImage?.base64,
      liveContext
    );
  }

  async function handleSpeechSummary() {
    setLoadingMode("summary");
    setStatus(text.statuses.transcribing);

    try {
      let liveContext = await fetchLivePageContext().catch(() => pageContext);
      ensureSupportedVideoForAnalysis(liveContext);
      let transcriptText = "";
      let fallbackInstruction = "";
      let visualCueInstruction = "";
      let detailFrameImageBase64List: string[] | undefined;

      try {
        const transcription = await fetchLiveAudioTranscription();
        liveContext = transcription.context;
        transcriptText = transcription.transcriptText;
      } catch (error) {
        const fallbackTranscript =
          liveContext.transcriptText?.trim() || liveContext.subtitleText?.trim() || "";

        if (!fallbackTranscript) {
          throw error;
        }

        transcriptText = fallbackTranscript;
        fallbackInstruction = text.audioFallbackInstruction;
      }

      if (!transcriptText.trim()) {
        throw new Error(text.audioUnavailable);
      }

      const visualCueCandidates = buildVisualCueCandidates(transcriptText, liveContext.duration);
      setStatus(text.statuses.judgingVisualCues);
      const visualCueJudgements = await requestVisualCueJudgements(
        visualCueCandidates,
        liveContext
      );
      const visualCuePlan = buildVisualCueFramePlan(
        transcriptText,
        liveContext.duration,
        visualCueJudgements
      );

      if (visualCuePlan.frameTimes.length > 0 && providerConfig.visionEnabled) {
        setStatus(text.statuses.samplingFrames);
        const frameSeries = await fetchLiveFrameSeries(visualCuePlan.frameTimes).catch(() => null);

        if (frameSeries?.frames.length) {
          liveContext = frameSeries.context;
          detailFrameImageBase64List = frameSeries.frames.map((frame) => frame.imageBase64);
          visualCueInstruction = buildDetailedSummaryVisualCueInstruction(
            visualCuePlan.cues,
            frameSeries.frames,
            visualCuePlan.denseWarnings,
            locale
          );
        } else {
          visualCueInstruction =
            locale === "zh"
              ? "检测到视觉提示关键词，但自动抽帧没有返回可用画面。本次细节摘要请只根据语音转写和字幕生成，不要编造画面内容。"
              : "Visual cue keywords were detected, but automatic frame capture returned no usable frames. Build this detailed summary only from the speech transcript and subtitles, and do not invent visual content.";
        }
      } else if (visualCuePlan.frameTimes.length > 0) {
        visualCueInstruction =
          locale === "zh"
            ? "检测到视觉提示关键词，但当前 API 配置未启用视觉能力，因此本次不进行画面分析，只根据语音转写和字幕生成细节摘要。"
            : "Visual cue keywords were detected, but vision is disabled in API settings. Do not perform frame analysis; build the detailed summary only from speech transcript and subtitles.";
      } else {
        visualCueInstruction = buildDetailedSummaryVisualCueInstruction([], [], [], locale);
      }

      await callAnalyze(
        "summary",
        mergeInstruction(
          [text.audioSummaryInstruction, fallbackInstruction, visualCueInstruction]
            .filter(Boolean)
            .join("\n\n")
        ),
        undefined,
        {
          ...liveContext,
          transcriptText
        },
        undefined,
        detailFrameImageBase64List
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : text.audioUnavailable;
      setResultTitle(locale === "zh" ? "转写失败" : "Transcription Error");
      setResultBody(message);
      setStatus(text.statuses.failed);
    } finally {
      setLoadingMode(null);
    }
  }

  async function handleFrameAnalysis() {
    const imageAttachment = attachments.find((attachment) => attachment.kind === "image");
    const frame = await fetchLiveFrame().catch(() => ({
      context: pageContext,
      imageBase64: null,
      paused: false
    }));

    if (imageAttachment?.base64) {
      await callAnalyze(
        "frame-analysis",
        mergeInstruction(text.frameQuestion),
        imageAttachment.base64,
        frame.context
      );
      return;
    }

    await callAnalyze(
      "frame-analysis",
      mergeInstruction(frame.paused ? text.frameQuestion : undefined),
      frame.imageBase64 ?? undefined,
      frame.context
    );
  }

  async function handleTranslateSelection() {
    if (!selectedText.trim()) {
      setStatus(text.translationEmpty);
      return;
    }

    setStatus(text.translationLoading);

    const translationPrompt =
      translationDirection === "en-to-zh"
        ? `请把下面选中的英文内容翻译成中文，并保持简短清楚：\n\n${selectedText}`
        : `Please translate the selected Chinese content into English and keep it concise and clear:\n\n${selectedText}`;

    try {
      const result = await requestAnalyze("qa", translationPrompt, undefined, pageContext);
      setSelectionTranslation(result.body);
      setStatus(text.statuses.done);
    } catch (error) {
      const message = error instanceof Error ? error.message : text.requestFailed;
      setSelectionTranslation(message);
      setStatus(text.statuses.failed);
    }
  }

  async function handleChatSubmit() {
    if (!chatActive || isLoading) {
      return;
    }

    if (!question.trim() && attachments.length === 0) {
      return;
    }

    const finalQuestion = buildAttachmentPrompt(question, attachments);
    const firstImage = attachments.find((attachment) => attachment.kind === "image");
    const liveContext = await fetchLivePageContext().catch(() => pageContext);

    setChatHistory((currentHistory) => [
      ...currentHistory,
      { role: "user", content: finalQuestion }
    ]);
    const nextConversationHistory = buildConversationHistory([
      ...chatHistory,
      { role: "user", content: finalQuestion }
    ]);

    setQuestion("");
    setAttachments([]);

    await callAnalyze(
      "qa",
      mergeInstruction(finalQuestion),
      firstImage?.base64,
      liveContext,
      nextConversationHistory
    );
  }

  return (
    <SidebarShell>
      <header className="hero">
        <div>
          <h1>{text.heroTitle}</h1>
          <p>{text.heroSubtitle}</p>
        </div>
        <div className="hero-actions">
          <div className="language-switch" aria-label={text.language}>
            <button
              type="button"
              className={locale === "zh" ? "lang-button active" : "lang-button"}
              onClick={() => setLocale("zh")}
            >
              中文
            </button>
            <button
              type="button"
              className={locale === "en" ? "lang-button active" : "lang-button"}
              onClick={() => setLocale("en")}
            >
              EN
            </button>
          </div>
          <span className="chip">{text.chip(activeSkillCount)}</span>
        </div>
      </header>

      {isLocalPreview ? <div className="preview-banner">{text.previewMode}</div> : null}

      <nav className="screen-nav screen-nav-four">
        <button
          type="button"
          className={screen === "assistant" ? "nav-button active" : "nav-button"}
          onClick={() => setScreen("assistant")}
        >
          {text.screens.assistant}
        </button>
        <button
          type="button"
          className={screen === "mindmap" ? "nav-button active" : "nav-button"}
          onClick={() => setScreen("mindmap")}
        >
          {text.screens.mindmap}
        </button>
        <button
          type="button"
          className={screen === "skill" ? "nav-button active" : "nav-button"}
          onClick={() => setScreen("skill")}
        >
          {text.screens.skill}
        </button>
        <button
          type="button"
          className={screen === "api" ? "nav-button active" : "nav-button"}
          onClick={() => setScreen("api")}
        >
          {text.screens.api}
        </button>
      </nav>

      {screen === "assistant" ? (
        <div className="screen-stack">
          <section className="panel result-panel">
            <div className="assistant-fixed-actions">
              <div className="panel-subtle">
                {text.currentVideo}: {pageContext.title}
                {" · "}
                {Math.floor(pageContext.currentTime)}s
              </div>
              <div className="action-grid three-actions">
                <button type="button" disabled={isLoading} onClick={() => void handleSummary()}>
                  {text.summary}
                </button>
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => void handleSpeechSummary()}
                >
                  {text.speechSummary}
                </button>
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => void handleFrameAnalysis()}
                >
                  {text.imageAnalysis}
                </button>
              </div>
            </div>
            <div className="panel-head result-head">
              <div className="panel-head-main">
                <h2>{resultTitle}</h2>
                <span className="status-text">{status}</span>
              </div>
              <button
                type="button"
                className="secondary-button collapse-button"
                onClick={() => setResultCollapsed((collapsed) => !collapsed)}
              >
                {resultCollapsed ? text.expandResult : text.collapseResult}
              </button>
            </div>
            {!resultCollapsed ? (
              <>
                {isLoading ? (
                  <div className="loading-strip" aria-live="polite">
                    <span className="spinner" aria-hidden="true" />
                    <span>{text.loading}</span>
                  </div>
                ) : null}
                <div className="translation-switch-row">
                  <span className="translation-switch-label">{text.translationDirection}</span>
                  <div className="translation-switch">
                    <button
                      type="button"
                      className={
                        translationDirection === "en-to-zh"
                          ? "translation-option active"
                          : "translation-option"
                      }
                      onClick={() => setTranslationDirection("en-to-zh")}
                    >
                      {text.enToZh}
                    </button>
                    <button
                      type="button"
                      className={
                        translationDirection === "zh-to-en"
                          ? "translation-option active"
                          : "translation-option"
                      }
                      onClick={() => setTranslationDirection("zh-to-en")}
                    >
                      {text.zhToEn}
                    </button>
                  </div>
                </div>
                {isTimelineSummaryTitle ? (
                  <TimelineSummaryView
                    body={resultBody}
                    locale={locale}
                    labels={actionLabels}
                    selectedText={selectedText}
                    activeFeedbackTargetId={activeFeedbackTargetId}
                    responsePreference={responsePreference}
                    onTextSelect={handleSelectionCapture}
                    onCopy={(content) => void handleCopy(content)}
                    onTranslateSelection={() => void handleTranslateSelection()}
                    onLike={handleLike}
                    onDislike={handleDislike}
                  />
                ) : (
                  <div className="result-card-shell" onMouseUp={handleSelectionCapture}>
                    <MarkdownContent
                      source={resultBody}
                      className="result-body markdown-content"
                    />
                    <ResultToolbar
                      targetId="result-main"
                      labels={actionLabels}
                      selectedText={selectedText}
                      activeFeedbackTargetId={activeFeedbackTargetId}
                      responsePreference={responsePreference}
                      onCopy={() => void handleCopy(resultBody)}
                      onTranslate={() => void handleTranslateSelection()}
                      onLike={handleLike}
                      onDislike={handleDislike}
                    />
                  </div>
                )}
                {selectionTranslation ? (
                  <section className="translation-card">
                    <div className="timeline-block-title">{text.translationTitle}</div>
                    <MarkdownContent
                      source={selectionTranslation}
                      className="timeline-block-body markdown-content"
                    />
                  </section>
                ) : null}
              </>
            ) : null}

            <div className="chat-panel">
              <div className="chat-title-row">
                <h3>{text.continueChat}</h3>
                <span className={chatActive ? "chat-badge active" : "chat-badge stopped"}>
                  {chatActive ? text.active : text.stopped}
                </span>
              </div>

              <div className="chat-history">
                {chatHistory.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={
                      message.role === "user" ? "chat-bubble user" : "chat-bubble assistant"
                    }
                  >
                    <MarkdownContent
                      source={message.content}
                      className="markdown-content chat-markdown"
                    />
                  </div>
                ))}
                {loadingMode === "qa" ? (
                  <div className="chat-bubble assistant loading-bubble" aria-live="polite">
                    <span className="spinner" aria-hidden="true" />
                    <span>{text.answerLoading}</span>
                  </div>
                ) : null}
              </div>

              {attachments.length > 0 ? (
                <div className="attachment-list">
                  {attachments.map((attachment) => (
                    <div key={attachment.id} className="attachment-card">
                      <div className="attachment-meta">
                        <strong>{attachment.name}</strong>
                        <span>
                          {text.attachmentKinds[attachment.kind]} · {attachment.sizeLabel}
                        </span>
                      </div>
                      {attachment.previewUrl ? (
                        <img
                          className="attachment-preview"
                          src={attachment.previewUrl}
                          alt={attachment.name}
                        />
                      ) : null}
                      {attachment.content ? (
                        <pre className="attachment-content-preview">
                          {attachment.content.slice(0, 240)}
                        </pre>
                      ) : null}
                      <button
                        type="button"
                        className="attachment-remove"
                        onClick={() => removeAttachment(attachment.id)}
                      >
                        {text.remove}
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <label className="form-grid">
                {text.dialogue}
                <div className="composer-shell">
                  <div className="composer-input-wrap">
                    <textarea
                      rows={3}
                      value={question}
                      disabled={!chatActive || isLoading}
                      placeholder={chatActive ? text.placeholderActive : text.placeholderStopped}
                      onChange={(event) => setQuestion(event.target.value)}
                    />
                  </div>
                  <div className="composer-actions composer-actions-under">
                    <div className="attach-wrap">
                      <button
                        type="button"
                        className="plus-button"
                        disabled={isLoading}
                        onClick={() => setAttachmentMenuOpen((open) => !open)}
                      >
                        +
                      </button>
                      {attachmentMenuOpen ? (
                        <div className="attach-menu">
                          <button
                            type="button"
                            className="menu-button"
                            onClick={() => imageInputRef.current?.click()}
                          >
                            {text.uploadImage}
                          </button>
                          <button
                            type="button"
                            className="menu-button"
                            onClick={() => wordInputRef.current?.click()}
                          >
                            {text.uploadWord}
                          </button>
                          <button
                            type="button"
                            className="menu-button"
                            onClick={() => codeInputRef.current?.click()}
                          >
                            {text.uploadCode}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setHistoryOpen((open) => !open)}
                    >
                      {text.history}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={isLoading}
                      onClick={handleToggleChat}
                    >
                      {chatActive ? text.stopButton : text.startButton}
                    </button>
                    <button
                      type="button"
                      disabled={!chatActive || isLoading}
                      onClick={() => void handleChatSubmit()}
                    >
                      {text.send}
                    </button>
                  </div>
                </div>
              </label>

              {historyOpen ? (
                <section className="history-panel">
                  <div className="history-panel-head">
                    <strong>{text.history}</strong>
                  </div>
                  <input
                    className="history-search"
                    value={historyQuery}
                    placeholder={text.historySearch}
                    onChange={(event) => setHistoryQuery(event.target.value)}
                  />
                  {filteredHistorySessions.length > 0 ? (
                    <div className="history-list">
                      {filteredHistorySessions.map((session) => (
                        <article key={session.id} className="history-row">
                          <button
                            type="button"
                            className="history-row-main"
                            onClick={() => handleLoadHistorySession(session)}
                          >
                            <span className="history-row-title">
                              {buildHistorySessionTitle(session, locale)}
                            </span>
                            <span className="history-row-preview">
                              {buildHistorySessionPreview(session, locale)}
                            </span>
                            <span className="history-row-meta">
                              {new Date(session.updatedAt).toLocaleString(
                                session.locale === "zh" ? "zh-CN" : "en-US"
                              )}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="history-row-delete"
                            title={text.historyDelete}
                            aria-label={text.historyDelete}
                            onClick={() => handleDeleteHistorySession(session.id)}
                          >
                            <TrashIcon />
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="history-empty-state">{text.historyEmpty}</div>
                  )}
                </section>
              ) : null}

              <input
                ref={imageInputRef}
                hidden
                type="file"
                accept="image/*"
                onChange={(event) => void handleAttachmentPick("image", event)}
              />
              <input
                ref={wordInputRef}
                hidden
                type="file"
                accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) => void handleAttachmentPick("word", event)}
              />
              <input
                ref={codeInputRef}
                hidden
                type="file"
                accept=".ts,.tsx,.js,.jsx,.py,.java,.c,.cpp,.cs,.go,.rs,.sql,.json,.md,.html,.css,.txt"
                onChange={(event) => void handleAttachmentPick("code", event)}
              />
            </div>
          </section>

          <section className="panel prompt-panel">
            <div className="panel-head">
              <h2>{text.promptTitle}</h2>
            </div>
            <p className="panel-note prompt-note">{text.promptNote}</p>
            <label className="form-grid">
              <textarea
                rows={4}
                value={customPrompt}
                placeholder={text.promptPlaceholder}
                onChange={(event) => setCustomPrompt(event.target.value)}
              />
            </label>
          </section>
        </div>
      ) : null}

      {screen === "mindmap" ? (
        <section className="panel result-panel">
          <div className="panel-head">
            <h2>{text.mindmapTitle}</h2>
            <span className="status-text">{status}</span>
          </div>
          {loadingMode === "mindmap" ? (
            <div className="loading-strip" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <span>{text.statuses.mindmap}</span>
            </div>
          ) : null}
          <div className="translation-switch-row">
            <span className="translation-switch-label">{text.translationDirection}</span>
            <div className="translation-switch">
              <button
                type="button"
                className={
                  translationDirection === "en-to-zh"
                    ? "translation-option active"
                    : "translation-option"
                }
                onClick={() => setTranslationDirection("en-to-zh")}
              >
                {text.enToZh}
              </button>
              <button
                type="button"
                className={
                  translationDirection === "zh-to-en"
                    ? "translation-option active"
                    : "translation-option"
                }
                onClick={() => setTranslationDirection("zh-to-en")}
              >
                {text.zhToEn}
              </button>
            </div>
          </div>
          <p className="panel-note">{text.mindmapNote}</p>
          <div className="action-row split-actions">
            <div className="inline-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={isLoading || mindMapNodes.length === 0}
                onClick={() => void handleMindMapExport()}
              >
                {text.exportMindmap}
              </button>
              <div className="layout-picker">
                <button
                  type="button"
                  className="secondary-button layout-trigger"
                  disabled={isLoading}
                  aria-label={`${text.mindmapLayoutChoose}: ${formatMindMapPreference(
                    mindMapLayoutPreference,
                    locale,
                    text
                  )}`}
                  title={`${text.mindmapLayoutChoose}: ${formatMindMapPreference(
                    mindMapLayoutPreference,
                    locale,
                    text
                  )}`}
                  onClick={() => setMindMapLayoutMenuOpen((open) => !open)}
                >
                  <span className="layout-trigger-label">
                    {formatCompactMindMapPreference(mindMapLayoutPreference, locale)}
                  </span>
                  <span
                    className={mindMapLayoutMenuOpen ? "layout-trigger-caret open" : "layout-trigger-caret"}
                    aria-hidden="true"
                  >
                    ▾
                  </span>
                </button>
                {mindMapLayoutMenuOpen ? (
                  <div className="layout-menu">
                    {(["auto", "tree", "timeline", "cluster", "comparison"] as const).map(
                      (option) => (
                        <button
                          key={option}
                          type="button"
                          className={
                            mindMapLayoutPreference === option
                              ? "layout-option active"
                              : "layout-option"
                          }
                          onClick={() => {
                            setMindMapLayoutPreference(option);
                            setMindMapLayoutMenuOpen(false);
                          }}
                        >
                          {formatMindMapPreference(option, locale, text)}
                        </button>
                      )
                    )}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => void handleMindMapGenerate()}
              >
                {text.generateMindmap}
              </button>
            </div>
          </div>
          <div ref={mindmapCanvasRef} className="mindmap-canvas">
            {mindMapNodes.length > 0 ? (
              <div className="mindmap-layout-shell">
                <div className="mindmap-layout-meta">
                  <span className="mindmap-layout-badge">
                    {formatMindMapType(parsedMindMap.type, locale)}
                  </span>
                  <strong>{parsedMindMap.title}</strong>
                </div>
                {parsedMindMap.summary ? (
                  <MarkdownContent
                    source={parsedMindMap.summary}
                    className="mindmap-layout-summary markdown-content"
                  />
                ) : null}
                <MindMapCanvasView mindMap={parsedMindMap} />
              </div>
            ) : (
              <div className="mindmap-empty">{text.mindmapEmpty}</div>
            )}
          </div>
          <div className="mindmap-readable-shell" onMouseUp={handleSelectionCapture}>
            <div className="mindmap-readable-head">
              <div className="mindmap-readable-badge">{text.mindmapReadableTitle}</div>
              <div className="mindmap-readable-note">{text.mindmapReadableNote}</div>
            </div>
            <MindMapReadableSection mindMap={parsedMindMap} locale={locale} />
            <ResultToolbar
              targetId="mindmap-readable"
              labels={actionLabels}
              selectedText={selectedText}
              activeFeedbackTargetId={activeFeedbackTargetId}
              responsePreference={responsePreference}
              onCopy={() => void handleCopy(buildMindMapReadableText(parsedMindMap, locale))}
              onTranslate={() => void handleTranslateSelection()}
              onLike={handleLike}
              onDislike={handleDislike}
            />
            <details className="mindmap-raw-details">
              <summary>{text.mindmapRawToggle}</summary>
              <pre className="result-body mindmap-raw">{mindMapDisplaySource}</pre>
            </details>
          </div>
          {selectionTranslation ? (
            <section className="translation-card">
              <div className="timeline-block-title">{text.translationTitle}</div>
              <MarkdownContent
                source={selectionTranslation}
                className="timeline-block-body markdown-content"
              />
            </section>
          ) : null}
        </section>
      ) : null}

      {screen === "skill" ? (
        <SkillManager
          locale={locale}
          skills={skills}
          onInstallSkill={handleInstallSkill}
          onToggleSkill={handleToggleSkill}
        />
      ) : null}

      {screen === "api" ? (
        <SettingsPanel
          locale={locale}
          providerConfig={providerConfig}
          onProviderConfigChange={setProviderConfig}
        />
      ) : null}
    </SidebarShell>
  );
}


