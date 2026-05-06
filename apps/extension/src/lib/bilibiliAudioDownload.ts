export interface CapturedBilibiliMediaRequest {
  url: string;
  pageUrl?: string;
  requestHeaders?: Record<string, string>;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function getUrlHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 80);
  }
}

function buildFetchAttempts(capturedHeaders?: Record<string, string>) {
  const accept = capturedHeaders?.accept || "*/*";
  const acceptLanguage = capturedHeaders?.["accept-language"];
  const range = capturedHeaders?.range || "bytes=0-";
  const withAcceptLanguage = (headers: Record<string, string>) => {
    if (acceptLanguage) {
      return {
        ...headers,
        "Accept-Language": acceptLanguage
      };
    }

    return headers;
  };

  return [
    {
      label: "range",
      headers: withAcceptLanguage({
        Accept: accept,
        Range: range
      })
    },
    {
      label: "no-range",
      headers: withAcceptLanguage({
        Accept: accept
      })
    },
    {
      label: "origin-range",
      headers: withAcceptLanguage({
        Accept: accept,
        Origin: "https://www.bilibili.com",
        Range: range
      })
    }
  ];
}

function pickReferrer(capturedRequest?: CapturedBilibiliMediaRequest) {
  const pageUrl = capturedRequest?.pageUrl;

  if (pageUrl?.startsWith("https://www.bilibili.com/")) {
    return pageUrl;
  }

  const capturedHeaders = capturedRequest?.requestHeaders;
  const referer = capturedHeaders?.referer;

  if (referer?.startsWith("https://www.bilibili.com/")) {
    return referer;
  }

  return "https://www.bilibili.com/";
}

export async function fetchBilibiliAudioBlob(
  url: string | string[],
  capturedRequest?: CapturedBilibiliMediaRequest
) {
  const urls = Array.isArray(url) ? url : [url];
  let lastError: unknown;

  for (const audioUrl of urls) {
    for (const attempt of buildFetchAttempts(capturedRequest?.requestHeaders)) {
      let response: Response;

      try {
        response = await fetch(audioUrl, {
          credentials: "include",
          headers: attempt.headers,
          referrer: pickReferrer(capturedRequest),
          referrerPolicy: "origin-when-cross-origin"
        });
      } catch (error) {
        lastError = new Error(
          `Failed to fetch Bilibili audio track from ${getUrlHost(audioUrl)} with ${attempt.label}. Detail: ${getErrorMessage(error)}`
        );
        continue;
      }

      if (!response.ok) {
        lastError = new Error(
          `Failed to fetch Bilibili audio track: ${response.status} (${attempt.label})`
        );
        continue;
      }

      return response.blob();
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to fetch Bilibili audio track.");
}
