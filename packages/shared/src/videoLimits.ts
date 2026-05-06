export const MAX_SUPPORTED_VIDEO_DURATION_SECONDS = 3 * 60 * 60;
export const DEFAULT_TRANSCRIPT_PROMPT_CHAR_BUDGET = 140_000;

const TIMESTAMPED_LINE_PATTERN =
  /^\s*(?:[-*]\s+)?(?:\[\s*)?(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)/;

export function formatSupportedVideoDuration() {
  const minutes = Math.floor(MAX_SUPPORTED_VIDEO_DURATION_SECONDS / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return `${hours}:${String(remainingMinutes).padStart(2, "0")}:00`;
}

export function isSupportedVideoDuration(duration?: number) {
  return (
    duration === undefined ||
    !Number.isFinite(duration) ||
    duration <= MAX_SUPPORTED_VIDEO_DURATION_SECONDS
  );
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

function buildCompactionHeader(locale: "zh" | "en", originalLength: number) {
  if (locale === "en") {
    return `[Transcript compacted for stable 3-hour video support. Original text length: ${originalLength} chars. The compacted transcript keeps chronological coverage across the whole video.]\n`;
  }

  return `[已为稳定支持 3 小时视频压缩转录文本。原始文本长度：${originalLength} 字符。压缩文本会尽量保留整条视频的时间线覆盖。]\n`;
}

function truncateText(text: string, limit: number) {
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, Math.max(0, limit - 24)).trim()} ...`;
}

function compactTimestampedTranscript(
  transcriptText: string,
  locale: "zh" | "en",
  budget: number
) {
  const lines = transcriptText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const timestampedLines = lines
    .map((line) => {
      const match = line.match(TIMESTAMPED_LINE_PATTERN);
      const startTime = match ? parseTimestampToSeconds(match[1]) : null;

      return startTime === null ? null : { line, startTime };
    })
    .filter((item): item is { line: string; startTime: number } => Boolean(item));

  if (timestampedLines.length === 0) {
    return "";
  }

  const header = buildCompactionHeader(locale, transcriptText.length);
  const remainingBudget = Math.max(800, budget - header.length);
  const bucketSizeSeconds = 5 * 60;
  const buckets = new Map<number, string[]>();

  for (const item of timestampedLines) {
    const bucketIndex = Math.floor(item.startTime / bucketSizeSeconds);
    buckets.set(bucketIndex, [...(buckets.get(bucketIndex) ?? []), item.line]);
  }

  const bucketEntries = Array.from(buckets.entries()).sort(([left], [right]) => left - right);
  const perBucketBudget = Math.max(180, Math.floor(remainingBudget / bucketEntries.length));
  const compactedBuckets = bucketEntries.map(([bucketIndex, bucketLines]) => {
    const startMinute = bucketIndex * 5;
    const endMinute = startMinute + 5;
    const label =
      locale === "en"
        ? `\n[Long-video window ${startMinute}-${endMinute} min]\n`
        : `\n[长视频窗口 ${startMinute}-${endMinute} 分钟]\n`;
    const joined = bucketLines.join(" ");

    return `${label}${truncateText(joined, Math.max(80, perBucketBudget - label.length))}`;
  });

  return `${header}${compactedBuckets.join("\n")}`;
}

function compactPlainTranscript(
  transcriptText: string,
  locale: "zh" | "en",
  budget: number
) {
  const header = buildCompactionHeader(locale, transcriptText.length);
  const remainingBudget = Math.max(300, budget - header.length);
  const partBudget = Math.floor(remainingBudget / 3);
  const middleStart = Math.max(0, Math.floor(transcriptText.length / 2 - partBudget / 2));

  return [
    header,
    transcriptText.slice(0, partBudget).trim(),
    "\n[...]\n",
    transcriptText.slice(middleStart, middleStart + partBudget).trim(),
    "\n[...]\n",
    transcriptText.slice(Math.max(0, transcriptText.length - partBudget)).trim()
  ].join("");
}

export function compactTranscriptForPrompt(
  transcriptText: string,
  locale: "zh" | "en" = "zh",
  budget = DEFAULT_TRANSCRIPT_PROMPT_CHAR_BUDGET
) {
  if (transcriptText.length <= budget) {
    return transcriptText;
  }

  return (
    compactTimestampedTranscript(transcriptText, locale, budget) ||
    compactPlainTranscript(transcriptText, locale, budget)
  );
}
