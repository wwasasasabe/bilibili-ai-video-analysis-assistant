import type { PageContext, ProviderConfig } from "@app/shared";
import {
  fetchBilibiliAudioBlob,
  getUrlHost,
  type CapturedBilibiliMediaRequest
} from "../lib/bilibiliAudioDownload";
import { fetchBilibiliAudioDataUrlFromPage } from "../lib/pageAudioDownload";
import { requestAudioTranscription } from "../lib/provider";
import { getBilibiliAudioTranscriptionInputMode } from "../lib/transcriptionRouting";

interface AudioUrlResponse {
  ok: boolean;
  context?: PageContext | null;
  audioUrls?: string[];
  pageUrl?: string;
  error?: string;
}

interface CapturedMediaRequest extends CapturedBilibiliMediaRequest {
  tabId: number;
  requestId: string;
  mimeType?: string;
  time: number;
}

const BILIBILI_MEDIA_REQUEST_FILTER = {
  urls: [
    "https://*.bilivideo.com/*",
    "https://*.bilivideo.cn/*",
    "https://*.akamaized.net/*",
    "https://*.hdslb.com/*"
  ]
};
const pendingRequestHeaders = new Map<string, Record<string, string>>();
const capturedMediaRequests = new Map<number, CapturedMediaRequest[]>();
const MAX_CAPTURED_MEDIA_REQUESTS_PER_TAB = 240;

async function enableSidePanelOnActionClick() {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return;
  }

  await chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
  });
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  return tab.id;
}

async function forwardToTab(tabId: number, message: unknown) {
  return chrome.tabs.sendMessage(tabId, message);
}

async function forwardToActiveTab(message: unknown) {
  const tabId = await getActiveTabId();
  return forwardToTab(tabId, message);
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function dataUrlToBlob(dataUrl: string) {
  const [metadata = "", base64 = ""] = dataUrl.split(",");
  const mimeType = metadata.match(/^data:([^;]+)/)?.[1] || "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], {
    type: mimeType
  });
}

async function blobToDataUrl(blob: Blob) {
  const mimeType = blob.type || "audio/mp4";
  return `data:${mimeType};base64,${arrayBufferToBase64(await blob.arrayBuffer())}`;
}

function normalizeRequestHeaders(headers?: chrome.webRequest.HttpHeader[]) {
  const normalized: Record<string, string> = {};

  for (const header of headers ?? []) {
    if (!header.name || typeof header.value !== "string") {
      continue;
    }

    normalized[header.name.toLowerCase()] = header.value;
  }

  return normalized;
}

function readHeader(headers: chrome.webRequest.HttpHeader[] | undefined, name: string) {
  return headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function isLikelyBilibiliMediaUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    return (
      (host.endsWith("bilivideo.com") ||
        host.endsWith("bilivideo.cn") ||
        host.endsWith("akamaized.net") ||
        host.endsWith("hdslb.com")) &&
      /\.(m4s|mp4|m4a|mp3|aac)(?:$|\?)/.test(`${path}${parsed.search.toLowerCase()}`)
    );
  } catch {
    return false;
  }
}

function isLikelyAudioRequest(url: string, mimeType?: string) {
  const normalizedMimeType = mimeType?.toLowerCase() ?? "";

  if (normalizedMimeType.startsWith("audio/")) {
    return true;
  }

  return /(^|[/?&_.-])(audio|30216|30232|30250|30251|30280)([/?&_.=-]|$)/i.test(url);
}

function rememberCapturedMediaRequest(request: CapturedMediaRequest) {
  const items = capturedMediaRequests.get(request.tabId) ?? [];
  const duplicateIndex = items.findIndex((item) => item.url === request.url);

  if (duplicateIndex >= 0) {
    items.splice(duplicateIndex, 1);
  }

  items.unshift(request);
  capturedMediaRequests.set(
    request.tabId,
    items.slice(0, MAX_CAPTURED_MEDIA_REQUESTS_PER_TAB)
  );
}

function getCapturedRequestForUrl(tabId: number, url: string) {
  return capturedMediaRequests.get(tabId)?.find((request) => request.url === url);
}

function buildAudioDownloadCandidates(tabId: number, audioUrls: string[]) {
  const candidates: Array<{
    url: string;
    capturedRequest?: CapturedMediaRequest;
  }> = [];
  const seen = new Set<string>();
  const push = (url: string, capturedRequest?: CapturedMediaRequest) => {
    if (!url || seen.has(url)) {
      return;
    }

    seen.add(url);
    candidates.push({ url, capturedRequest });
  };

  for (const audioUrl of audioUrls) {
    push(audioUrl, getCapturedRequestForUrl(tabId, audioUrl));
  }

  const capturedRequests = capturedMediaRequests.get(tabId) ?? [];

  for (const request of capturedRequests) {
    if (isLikelyAudioRequest(request.url, request.mimeType)) {
      push(request.url, request);
    }
  }

  for (const request of capturedRequests) {
    push(request.url, request);
  }

  return candidates;
}

async function transcribeActiveBilibiliAudio(providerConfig: ProviderConfig) {
  const tabId = await getActiveTabId();
  const audioResponse = (await forwardToTab(tabId, {
    type: "GET_BILIBILI_AUDIO_URLS"
  })) as AudioUrlResponse;

  if (!audioResponse?.ok) {
    throw new Error(audioResponse?.error || "Failed to read Bilibili audio URLs.");
  }

  const audioUrls = audioResponse.audioUrls ?? [];

  if (audioUrls.length === 0) {
    throw new Error("No Bilibili audio track URL was found on the current page.");
  }

  let lastError: unknown;
  const attemptErrors: string[] = [];

  const audioCandidates = buildAudioDownloadCandidates(tabId, audioUrls);
  const inputMode = getBilibiliAudioTranscriptionInputMode(providerConfig);

  if (inputMode === "blob") {
    try {
      const pageAudio = await fetchBilibiliAudioDataUrlFromPage(
        tabId,
        audioCandidates.map((candidate) => candidate.url),
        audioResponse.pageUrl
      );
      const transcriptText = await requestAudioTranscription({
        providerConfig,
        audioBlob: dataUrlToBlob(pageAudio.dataUrl)
      });

      return {
        ok: true,
        context: audioResponse.context ?? null,
        transcriptText,
        sourceUrl: pageAudio.sourceUrl
      };
    } catch (error) {
      lastError = error;
      attemptErrors.push(`page-context: ${getErrorMessage(error)}`);
    }
  }

  for (const { url: audioUrl, capturedRequest } of audioCandidates) {
    try {
      const transcriptText = inputMode === "blob"
          ? await requestAudioTranscription({
              providerConfig,
              audioBlob: await fetchBilibiliAudioBlob(audioUrl, {
                ...capturedRequest,
                url: capturedRequest?.url ?? audioUrl,
                pageUrl: audioResponse.pageUrl
              })
            })
        : await requestAudioTranscription({
            providerConfig,
            audioBase64: await blobToDataUrl(
              await fetchBilibiliAudioBlob(audioUrl, {
                ...capturedRequest,
                url: capturedRequest?.url ?? audioUrl,
                pageUrl: audioResponse.pageUrl
              })
            )
          });

      return {
        ok: true,
        context: audioResponse.context ?? null,
        transcriptText,
        sourceUrl: audioUrl
      };
    } catch (error) {
      lastError = error;
      attemptErrors.push(`${getUrlHost(audioUrl)}: ${getErrorMessage(error)}`);
    }
  }

  const detail = attemptErrors.slice(-3).join("\n");
  throw lastError instanceof Error
    ? new Error(`${lastError.message}\nTried ${audioCandidates.length} Bilibili audio URL(s).\n${detail}`)
    : new Error(`Failed to transcribe the Bilibili audio track. Tried ${audioCandidates.length} Bilibili audio URL(s).`);
}

void enableSidePanelOnActionClick();

chrome.runtime.onInstalled.addListener(() => {
  void enableSidePanelOnActionClick();
});

chrome.runtime.onStartup.addListener(() => {
  void enableSidePanelOnActionClick();
});

chrome.webRequest?.onSendHeaders.addListener(
  (details) => {
    if (details.tabId < 0 || !isLikelyBilibiliMediaUrl(details.url)) {
      return;
    }

    pendingRequestHeaders.set(details.requestId, normalizeRequestHeaders(details.requestHeaders));
  },
  BILIBILI_MEDIA_REQUEST_FILTER,
  ["requestHeaders", "extraHeaders"]
);

chrome.webRequest?.onResponseStarted.addListener(
  (details) => {
    if (details.tabId < 0 || !isLikelyBilibiliMediaUrl(details.url)) {
      pendingRequestHeaders.delete(details.requestId);
      return;
    }

    const mimeType = readHeader(details.responseHeaders, "content-type").split(";")[0]?.toLowerCase();
    const requestHeaders = pendingRequestHeaders.get(details.requestId) ?? {};
    pendingRequestHeaders.delete(details.requestId);

    rememberCapturedMediaRequest({
      url: details.url,
      tabId: details.tabId,
      requestId: details.requestId,
      requestHeaders,
      mimeType,
      time: Date.now()
    });
  },
  BILIBILI_MEDIA_REQUEST_FILTER,
  ["responseHeaders"]
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "BILIBILI_PAGE_READY") {
    sendResponse({ ok: true, url: message.url });
    return;
  }

  if (
    message.type === "GET_BILIBILI_PAGE_CONTEXT" ||
    message.type === "CAPTURE_BILIBILI_FRAME" ||
    message.type === "CAPTURE_BILIBILI_FRAME_SERIES" ||
    message.type === "GET_BILIBILI_AUDIO_URLS"
  ) {
    void forwardToActiveTab(message)
      .then((response) => sendResponse(response))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to communicate with the Bilibili page."
        })
      );

    return true;
  }

  if (message.type === "TRANSCRIBE_BILIBILI_AUDIO") {
    void transcribeActiveBilibiliAudio(message.providerConfig as ProviderConfig)
      .then((response) => sendResponse(response))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to transcribe the Bilibili audio track."
        })
      );

    return true;
  }
});
