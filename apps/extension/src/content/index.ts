import {
  readLivePageContext,
  isBilibiliVideoPage,
  findVideoElement,
  readCurrentAudioUrls
} from "../lib/bilibili";
import {
  captureVideoFrame,
  captureVideoFrameSeries,
  isPausedVideo
} from "../lib/frameCapture";

function buildContextResponse() {
  return readLivePageContext(document, window.location.href);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_BILIBILI_PAGE_CONTEXT") {
    void buildContextResponse()
      .then((context) =>
        sendResponse({
          ok: true,
          context
        })
      )
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Failed to read Bilibili page context."
        })
      );
    return true;
  }

  if (message.type === "CAPTURE_BILIBILI_FRAME") {
    const video = findVideoElement(document);
    void buildContextResponse()
      .then((context) =>
        sendResponse({
          ok: true,
          context,
          paused: isPausedVideo(video),
          imageBase64: captureVideoFrame(video)
        })
      )
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Failed to capture Bilibili frame."
        })
      );
    return true;
  }

  if (message.type === "CAPTURE_BILIBILI_FRAME_SERIES") {
    const video = findVideoElement(document);
    const sampleTimes = Array.isArray(message.sampleTimes)
      ? message.sampleTimes.filter((time: unknown): time is number => typeof time === "number")
      : undefined;

    void buildContextResponse()
      .then(async (context) =>
        sendResponse({
          ok: true,
          context,
          paused: isPausedVideo(video),
          frames: await captureVideoFrameSeries(video, {
            sampleTimes,
            maxFrames: sampleTimes?.length ? 48 : 18,
            maxWidth: 640,
            mimeType: "image/jpeg",
            quality: 0.68
          })
        })
      )
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to capture Bilibili frame series."
        })
      );
    return true;
  }

  if (message.type === "GET_BILIBILI_AUDIO_URLS") {
    void buildContextResponse()
      .then(async (context) =>
        sendResponse({
          ok: true,
          context,
          pageUrl: window.location.href,
          audioUrls: await readCurrentAudioUrls(document, window.location.href)
        })
      )
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to read Bilibili audio track URLs."
        })
      );
    return true;
  }
});

if (isBilibiliVideoPage(window.location.href)) {
  chrome.runtime.sendMessage({
    type: "BILIBILI_PAGE_READY",
    url: window.location.href
  });
}
