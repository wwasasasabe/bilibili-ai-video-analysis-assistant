import type { PageContext } from "@app/shared";

interface BilibiliSubtitleCue {
  from: number;
  to: number;
  content: string;
}

interface BilibiliSubtitlePayload {
  body?: Array<{
    from?: number;
    to?: number;
    content?: string;
  }>;
}

interface BilibiliPageItem {
  cid?: number;
  page?: number;
  part?: string;
  duration?: number;
}

interface BilibiliViewPayload {
  data?: {
    cid?: number;
    pages?: BilibiliPageItem[];
    subtitle?: {
      list?: unknown[];
    };
  };
}

interface BilibiliPlayerPayload {
  data?: {
    subtitle?: {
      subtitles?: Array<{
        subtitle_url?: unknown;
        subtitleUrl?: unknown;
      }>;
      list?: Array<{
        subtitle_url?: unknown;
        subtitleUrl?: unknown;
      }>;
    };
  };
}

interface BilibiliPlayUrlPayload {
  data?: unknown;
}

const subtitleNoiseFragments = [
  "字幕设置",
  "原声翻译",
  "体验反馈",
  "关闭",
  "中文",
  "双语",
  "自动翻译",
  "字幕样式",
  "字体大小",
  "背景不透明度"
];

const noteNoiseFragments = [
  "记笔记",
  "发布笔记",
  "公开发布",
  "仅自己可见",
  "插入时间点",
  "添加标题",
  "保存到笔记",
  "笔记设置"
];

const episodeTitleSelectors = [
  ".video-pod__item.active .title-txt",
  ".video-pod__item--active .title-txt",
  ".video-pod__item.active .title",
  ".video-pod__item--active .title",
  ".video-pod__item.active .title-text",
  ".video-pod__item--active .title-text",
  ".multi-page .cur-list .on .part",
  ".multi-page .list-box li.on .part",
  ".multi-page .cur-page .part",
  ".multi-page .part.active",
  '[class*="video-pod"] [class*="active"] [class*="title"]',
  '[class*="multi-page"] [class*="active"] .part',
  '[class*="multi-page"] [class*="on"] .part'
];

const noteSelectors = [
  ".video-note-content",
  ".note-content",
  ".note-content-box",
  ".note-panel-content",
  ".note-container .ql-editor",
  ".video-note-panel .ql-editor",
  ".video-note .ql-editor",
  '[class*="note-content"]',
  '[class*="note-panel"] .ql-editor',
  '[class*="note"] [class*="content"]'
];

const subtitleCueCache = new Map<string, Promise<BilibiliSubtitleCue[]>>();
const viewPayloadCache = new Map<string, Promise<BilibiliViewPayload>>();
const playerPayloadCache = new Map<string, Promise<BilibiliPlayerPayload>>();
const playUrlPayloadCache = new Map<string, Promise<BilibiliPlayUrlPayload>>();

export function isBilibiliVideoPage(url: string): boolean {
  return /^https:\/\/www\.bilibili\.com\/video\/.+/.test(url);
}

export function extractVideoId(url: string): string | null {
  const match = url.match(/\/video\/([^/?]+)/);
  return match?.[1] ?? null;
}

export function extractPageNumber(url: string): number | undefined {
  try {
    const page = new URL(url).searchParams.get("p");
    const parsed = Number(page);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function extractEpisodeInfo(url: string) {
  const episodeNumber = extractPageNumber(url);

  return {
    episodeNumber,
    episodeLabel: episodeNumber ? `P${episodeNumber}` : undefined
  };
}

export function readBasicPageContext(doc: Document) {
  const title =
    doc.querySelector("h1")?.textContent?.trim() ||
    doc.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
    "";
  const description =
    doc.querySelector('meta[name="description"]')?.getAttribute("content") ||
    doc.querySelector("#v_desc")?.textContent?.trim() ||
    "";

  return { title, description };
}

export function findVideoElement(doc: Document): HTMLVideoElement | null {
  return doc.querySelector("video");
}

export function readUploaderName(doc: Document) {
  return (
    doc.querySelector(".up-name")?.textContent?.trim() ||
    doc.querySelector('[data-vue-meta="author"]')?.textContent?.trim() ||
    doc.querySelector('meta[name="author"]')?.getAttribute("content") ||
    ""
  );
}

function sanitizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function sanitizeBlockText(text: string) {
  return text
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => sanitizeText(line))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isNoiseSubtitleText(text: string) {
  if (!text) {
    return true;
  }

  const hitCount = subtitleNoiseFragments.filter((fragment) => text.includes(fragment)).length;
  return hitCount >= 2;
}

function pickSubtitleCandidate(elements: Element[]) {
  const text = sanitizeText(
    elements
      .map((element) => element.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ")
  );

  if (!text || isNoiseSubtitleText(text)) {
    return "";
  }

  return text;
}

function decodeEscapedJsonString(value: string) {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return value.replace(/\\u002F/g, "/").replace(/\\\//g, "/");
  }
}

function normalizeSubtitleUrl(url: string) {
  if (!url) {
    return "";
  }

  if (url.startsWith("//")) {
    return `https:${url}`;
  }

  return url;
}

function extractSubtitleUrlsFromScripts(doc: Document) {
  const urls = new Set<string>();
  const regex = /"subtitle_url":"([^"]+)"/g;

  for (const script of Array.from(doc.scripts)) {
    const text = script.textContent ?? "";
    let match = regex.exec(text);

    while (match) {
      const decoded = normalizeSubtitleUrl(decodeEscapedJsonString(match[1]));

      if (decoded) {
        urls.add(decoded);
      }

      match = regex.exec(text);
    }
  }

  return Array.from(urls);
}

function extractSubtitleUrlsFromPlayerPayload(payload?: BilibiliPlayerPayload) {
  const urls = new Set<string>();
  const subtitle = payload?.data?.subtitle;
  const entries = [...(subtitle?.subtitles ?? []), ...(subtitle?.list ?? [])];

  for (const entry of entries) {
    const url = normalizeMediaUrl(entry.subtitle_url ?? entry.subtitleUrl);

    if (url) {
      urls.add(url);
    }
  }

  return Array.from(urls);
}

function extractBalancedBlock(text: string, openingIndex: number, openChar: string, closeChar: string) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = openingIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === openChar) {
      depth += 1;
      continue;
    }

    if (char === closeChar) {
      depth -= 1;

      if (depth === 0) {
        return text.slice(openingIndex, index + 1);
      }
    }
  }

  return "";
}

function normalizeMediaUrl(url: unknown) {
  return typeof url === "string" ? normalizeSubtitleUrl(decodeEscapedJsonString(url)) : "";
}

function addAudioItemUrls(item: unknown, urls: Set<string>) {
  if (!item || typeof item !== "object") {
    return;
  }

  const record = item as {
    baseUrl?: unknown;
    base_url?: unknown;
    backupUrl?: unknown;
    backup_url?: unknown;
  };
  const primaryUrl = normalizeMediaUrl(record.baseUrl ?? record.base_url);

  if (primaryUrl) {
    urls.add(primaryUrl);
  }

  const backupUrls = record.backupUrl ?? record.backup_url;

  if (Array.isArray(backupUrls)) {
    for (const backupUrl of backupUrls) {
      const normalized = normalizeMediaUrl(backupUrl);

      if (normalized) {
        urls.add(normalized);
      }
    }
  }
}

function collectAudioUrlsFromObject(value: unknown, urls: Set<string>) {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectAudioUrlsFromObject(item, urls);
    }
    return;
  }

  const record = value as Record<string, unknown>;

  if (Array.isArray(record.audio)) {
    for (const item of record.audio) {
      addAudioItemUrls(item, urls);
    }
  }

  for (const child of Object.values(record)) {
    if (child && typeof child === "object") {
      collectAudioUrlsFromObject(child, urls);
    }
  }
}

function extractPlayInfoObjects(text: string) {
  const objects: unknown[] = [];
  const regex = /__playinfo__\s*=/g;
  let match = regex.exec(text);

  while (match) {
    const openingIndex = text.indexOf("{", match.index);
    const objectText =
      openingIndex >= 0 ? extractBalancedBlock(text, openingIndex, "{", "}") : "";

    if (objectText) {
      try {
        objects.push(JSON.parse(objectText) as unknown);
      } catch {
        // Some Bilibili scripts are not strict JSON; the regex fallback below still handles them.
      }
    }

    match = regex.exec(text);
  }

  return objects;
}

function extractAudioArraysFromScript(text: string) {
  const arrays: unknown[] = [];
  const regex = /"audio"\s*:/g;
  let match = regex.exec(text);

  while (match) {
    const openingIndex = text.indexOf("[", match.index);
    const arrayText =
      openingIndex >= 0 ? extractBalancedBlock(text, openingIndex, "[", "]") : "";

    if (arrayText) {
      try {
        arrays.push(JSON.parse(arrayText) as unknown);
      } catch {
        // Ignore malformed snippets; URL scanning below is the final fallback.
      }
    }

    match = regex.exec(text);
  }

  return arrays;
}

function collectAudioUrlsFromFallbackScan(text: string, urls: Set<string>) {
  const regex = /"((?:https?:)?\\?\/\\?\/[^"]+?\.m4s[^"]*)"/g;
  let match = regex.exec(text);

  while (match) {
    const decoded = normalizeMediaUrl(match[1]);

    if (decoded && /audio|30216|30232|30280|30250|30251/i.test(decoded)) {
      urls.add(decoded);
    }

    match = regex.exec(text);
  }
}

export function extractAudioUrlsFromScripts(doc: Document) {
  const urls = new Set<string>();

  for (const script of Array.from(doc.scripts)) {
    const text = script.textContent ?? "";

    for (const playInfo of extractPlayInfoObjects(text)) {
      collectAudioUrlsFromObject(playInfo, urls);
    }

    for (const audioArray of extractAudioArraysFromScript(text)) {
      if (Array.isArray(audioArray)) {
        for (const item of audioArray) {
          addAudioItemUrls(item, urls);
        }
      }
    }

    collectAudioUrlsFromFallbackScan(text, urls);
  }

  return Array.from(urls);
}

function extractAudioUrlsFromPlayUrlPayload(payload?: BilibiliPlayUrlPayload) {
  const urls = new Set<string>();
  collectAudioUrlsFromObject(payload?.data, urls);
  return Array.from(urls);
}

async function fetchSubtitlePayload(url: string) {
  const response = await fetch(url, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch subtitle payload: ${response.status}`);
  }

  return (await response.json()) as BilibiliSubtitlePayload;
}

async function fetchViewPayload(videoId: string) {
  const cached = viewPayloadCache.get(videoId);

  if (cached) {
    return cached;
  }

  const task = (async () => {
    const response = await fetch(
      `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(videoId)}`,
      {
        credentials: "include"
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch Bilibili view payload: ${response.status}`);
    }

    return (await response.json()) as BilibiliViewPayload;
  })().catch((error) => {
    viewPayloadCache.delete(videoId);
    throw error;
  });

  viewPayloadCache.set(videoId, task);
  return task;
}

async function fetchPlayerPayload(videoId: string, cid: number) {
  const cacheKey = `${videoId}:${cid}`;
  const cached = playerPayloadCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const task = (async () => {
    const response = await fetch(
      `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(videoId)}&cid=${encodeURIComponent(String(cid))}`,
      {
        credentials: "include"
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch Bilibili player payload: ${response.status}`);
    }

    return (await response.json()) as BilibiliPlayerPayload;
  })().catch((error) => {
    playerPayloadCache.delete(cacheKey);
    throw error;
  });

  playerPayloadCache.set(cacheKey, task);
  return task;
}

async function fetchPlayUrlPayload(videoId: string, cid: number) {
  const cacheKey = `${videoId}:${cid}`;
  const cached = playUrlPayloadCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const task = (async () => {
    const response = await fetch(
      [
        "https://api.bilibili.com/x/player/playurl",
        `?bvid=${encodeURIComponent(videoId)}`,
        `&cid=${encodeURIComponent(String(cid))}`,
        "&fnval=16&fourk=1"
      ].join(""),
      {
        credentials: "include"
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch Bilibili playurl payload: ${response.status}`);
    }

    return (await response.json()) as BilibiliPlayUrlPayload;
  })().catch((error) => {
    playUrlPayloadCache.delete(cacheKey);
    throw error;
  });

  playUrlPayloadCache.set(cacheKey, task);
  return task;
}

export function pickCurrentPageEntry(
  pages: BilibiliPageItem[],
  pageNumber?: number,
  fallbackCid?: number
) {
  if (pageNumber) {
    return pages.find((page) => page.page === pageNumber);
  }

  if (fallbackCid) {
    return pages.find((page) => page.cid === fallbackCid);
  }

  if (pages.length === 1) {
    return pages[0];
  }

  return undefined;
}

export async function readCurrentAudioUrls(doc: Document, url: string) {
  const videoId = extractVideoId(url);

  if (!videoId) {
    return extractAudioUrlsFromScripts(doc);
  }

  const viewPayload = await fetchViewPayload(videoId).catch(() => undefined);
  const selectedPageNumber = extractPageNumber(url);
  const currentPage = pickCurrentPageEntry(
    viewPayload?.data?.pages ?? [],
    selectedPageNumber,
    viewPayload?.data?.cid
  );
  const playUrlPayload = currentPage?.cid
    ? await fetchPlayUrlPayload(videoId, currentPage.cid).catch(() => undefined)
    : undefined;
  const currentPageAudioUrls = extractAudioUrlsFromPlayUrlPayload(playUrlPayload);

  return currentPageAudioUrls.length > 0
    ? currentPageAudioUrls
    : extractAudioUrlsFromScripts(doc);
}

async function getSubtitleCues(
  doc: Document,
  cacheKey: string,
  preferredSubtitleUrls: string[] = []
) {
  const cached = subtitleCueCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const task = (async () => {
    const subtitleUrls = Array.from(
      new Set([...preferredSubtitleUrls, ...extractSubtitleUrlsFromScripts(doc)].filter(Boolean))
    );

    for (const subtitleUrl of subtitleUrls) {
      try {
        const payload = await fetchSubtitlePayload(subtitleUrl);
        const cues =
          payload.body
            ?.map((item) => ({
              from: Number(item.from ?? 0),
              to: Number(item.to ?? 0),
              content: sanitizeText(item.content ?? "")
            }))
            .filter((item) => item.content && item.to >= item.from) ?? [];

        if (cues.length > 0) {
          return cues;
        }
      } catch {
        continue;
      }
    }

    return [] as BilibiliSubtitleCue[];
  })();

  subtitleCueCache.set(cacheKey, task);
  return task;
}

function findCueForTime(cues: BilibiliSubtitleCue[], currentTime: number) {
  const activeCue = cues.find((cue) => cue.from <= currentTime && currentTime <= cue.to + 0.2);

  if (activeCue) {
    return activeCue.content;
  }

  const nearCue = cues.find(
    (cue) => Math.abs(cue.from - currentTime) < 0.8 || Math.abs(cue.to - currentTime) < 0.8
  );

  return nearCue?.content ?? "";
}

function formatCueTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  const two = (value: number) => value.toString().padStart(2, "0");

  if (hours > 0) {
    return `${two(hours)}:${two(minutes)}:${two(remainingSeconds)}`;
  }

  return `${two(minutes)}:${two(remainingSeconds)}`;
}

export function buildTranscriptText(cues: BilibiliSubtitleCue[]) {
  if (cues.length === 0) {
    return undefined;
  }

  const lines: string[] = [];
  let previousText = "";

  for (const cue of cues) {
    const text = sanitizeText(cue.content);

    if (!text || previousText === text) {
      continue;
    }

    previousText = text;
    lines.push(`[${formatCueTime(cue.from)} - ${formatCueTime(cue.to)}] ${text}`);
  }

  return lines.length > 0 ? lines.join("\n") : undefined;
}

export function readSubtitleText(doc: Document, video: HTMLVideoElement | null) {
  const tracks = video?.textTracks;

  if (tracks) {
    for (let index = 0; index < tracks.length; index += 1) {
      const cues = tracks[index]?.activeCues;

      if (cues && cues.length > 0) {
        return sanitizeText(
          Array.from(cues)
            .map((cue) => ("text" in cue ? cue.text : ""))
            .filter(Boolean)
            .join(" ")
        );
      }
    }
  }

  const subtitleSelectors = [
    ".bpx-player-subtitle-panel-text",
    ".bpx-player-subtitle-panel-text span",
    ".bpx-player-subtitle-panel-text-item",
    ".bpx-player-subtitle-wrap .bpx-player-subtitle-text",
    ".bpx-player-subtitle-wrap .bpx-player-subtitle-text span",
    ".bilibili-player-video-subtitle .subtitle-item-text",
    ".bilibili-player-video-subtitle .subtitle-item",
    ".bpx-player-subtitle-line-text",
    ".bpx-player-subtitle-text"
  ];

  for (const selector of subtitleSelectors) {
    const elements = Array.from(doc.querySelectorAll(selector)).filter(
      (element) =>
        !element.closest(".bpx-player-ctrl-wrap") &&
        !element.closest(".bpx-player-control-wrap") &&
        !element.closest(".bpx-player-setting") &&
        !element.closest('[class*="setting"]')
    );
    const text = pickSubtitleCandidate(elements);

    if (text) {
      return text;
    }
  }

  return "";
}

export function readCurrentEpisodeTitle(doc: Document) {
  for (const selector of episodeTitleSelectors) {
    const text = sanitizeText(
      Array.from(doc.querySelectorAll(selector))
        .map((element) => element.textContent ?? "")
        .join(" ")
    );

    if (text && text.length >= 2) {
      return text;
    }
  }

  return undefined;
}

function isLikelyNoteText(text: string) {
  if (!text || text.length < 20) {
    return false;
  }

  if (noteNoiseFragments.some((fragment) => text === fragment)) {
    return false;
  }

  return true;
}

export function readBilibiliNoteText(doc: Document) {
  const collected = new Set<string>();

  for (const selector of noteSelectors) {
    const elements = Array.from(doc.querySelectorAll(selector)).slice(0, 6);

    for (const element of elements) {
      const text = sanitizeBlockText(element.textContent ?? "");

      if (!isLikelyNoteText(text)) {
        continue;
      }

      if (noteNoiseFragments.filter((fragment) => text.includes(fragment)).length >= 3) {
        continue;
      }

      collected.add(text);
    }
  }

  if (collected.size === 0) {
    return undefined;
  }

  return Array.from(collected)
    .sort((left, right) => right.length - left.length)
    .slice(0, 3)
    .join("\n\n");
}

function buildFallbackTitle(doc: Document) {
  return doc.title.replace(/_哔哩哔哩_bilibili$/, "").trim() || "Bilibili 视频";
}

export async function readLivePageContext(
  doc: Document,
  url: string
): Promise<PageContext | null> {
  const videoId = extractVideoId(url);

  if (!videoId) {
    return null;
  }

  const { title, description } = readBasicPageContext(doc);
  const viewPayload = await fetchViewPayload(videoId).catch(() => undefined);
  const selectedPageNumber = extractPageNumber(url);
  const currentPage = pickCurrentPageEntry(
    viewPayload?.data?.pages ?? [],
    selectedPageNumber,
    viewPayload?.data?.cid
  );
  const video = findVideoElement(doc);
  const currentTime = Number(video?.currentTime ?? 0);
  const duration =
    video && Number.isFinite(video.duration) && video.duration > 0
      ? Number(video.duration)
      : currentPage?.duration && currentPage.duration > 0
        ? Number(currentPage.duration)
        : undefined;
  const subtitleCacheKey = [
    videoId,
    selectedPageNumber ?? currentPage?.page ?? "p1",
    currentPage?.cid ?? viewPayload?.data?.cid ?? "cid"
  ].join(":");
  const playerPayload = currentPage?.cid
    ? await fetchPlayerPayload(videoId, currentPage.cid).catch(() => undefined)
    : undefined;
  const currentPageSubtitleUrls = extractSubtitleUrlsFromPlayerPayload(playerPayload);
  const subtitleCues = await getSubtitleCues(doc, subtitleCacheKey, currentPageSubtitleUrls);
  const domSubtitle = readSubtitleText(doc, video);
  const subtitleText =
    domSubtitle || findCueForTime(subtitleCues, currentTime) || undefined;
  const transcriptText = buildTranscriptText(subtitleCues);

  return {
    videoId,
    title: title || buildFallbackTitle(doc),
    description,
    uploader: readUploaderName(doc),
    pageNumber: selectedPageNumber ?? currentPage?.page,
    episodeTitle: readCurrentEpisodeTitle(doc) ?? currentPage?.part?.trim() ?? undefined,
    currentTime,
    duration,
    subtitleText,
    transcriptText,
    noteText: readBilibiliNoteText(doc),
    officialSubtitleAvailable: Boolean(
      currentPageSubtitleUrls.length || viewPayload?.data?.subtitle?.list?.length
    )
  };
}
