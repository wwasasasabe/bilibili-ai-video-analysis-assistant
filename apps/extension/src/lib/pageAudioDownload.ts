export interface PageAudioDownloadResult {
  dataUrl: string;
  mimeType: string;
  sourceUrl: string;
  byteLength: number;
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

function pickPageReferrer(pageUrl?: string) {
  return pageUrl?.startsWith("https://www.bilibili.com/")
    ? pageUrl
    : "https://www.bilibili.com/";
}

function buildPageFetchAttempts(): Array<{ label: string; headers: Record<string, string> }> {
  return [
    {
      label: "range",
      headers: {
        Accept: "*/*",
        Range: "bytes=0-"
      }
    },
    {
      label: "no-range",
      headers: {
        Accept: "*/*"
      }
    }
  ] satisfies Array<{ label: string; headers: Record<string, string> }>;
}

export async function fetchBilibiliAudioDataUrlInPage(
  audioUrls: string[],
  pageUrl?: string
): Promise<PageAudioDownloadResult> {
  let lastError = "No Bilibili audio URL was available.";

  for (const audioUrl of audioUrls) {
    if (!audioUrl) {
      continue;
    }

    for (const attempt of buildPageFetchAttempts()) {
      try {
        const response = await fetch(audioUrl, {
          credentials: "include",
          headers: attempt.headers,
          referrer: pickPageReferrer(pageUrl),
          referrerPolicy: "origin-when-cross-origin"
        });

        if (!response.ok) {
          lastError = `Failed to fetch Bilibili audio track: ${response.status} (${attempt.label})`;
          continue;
        }

        const mimeType = response.headers.get("content-type") || "audio/mp4";
        const buffer = await response.arrayBuffer();

        return {
          dataUrl: `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`,
          mimeType,
          sourceUrl: audioUrl,
          byteLength: buffer.byteLength
        };
      } catch (error) {
        lastError = `${attempt.label}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }

  throw new Error(lastError);
}

export async function fetchBilibiliAudioDataUrlFromPage(
  tabId: number,
  audioUrls: string[],
  pageUrl?: string
) {
  if (!chrome.scripting?.executeScript) {
    throw new Error("Page-context audio download is not available in this browser.");
  }

  const [injectionResult] = await chrome.scripting.executeScript({
    target: {
      tabId
    },
    world: "MAIN",
    func: fetchBilibiliAudioDataUrlInPage,
    args: [audioUrls, pageUrl]
  });
  const result = injectionResult?.result;

  if (!result?.dataUrl) {
    throw new Error("Bilibili page returned no downloadable audio data.");
  }

  return result;
}
