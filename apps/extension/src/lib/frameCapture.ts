export interface CapturedVideoFrame {
  time: number;
  imageBase64: string;
}

interface CaptureVideoFrameOptions {
  maxWidth?: number;
  mimeType?: "image/png" | "image/jpeg";
  quality?: number;
}

interface CaptureVideoFrameSeriesOptions extends CaptureVideoFrameOptions {
  maxFrames?: number;
  sampleTimes?: number[];
}

const DEFAULT_SAMPLE_FRAME_CAP = 18;
const SHORT_VIDEO_SECONDS = 30;
const TARGET_SAMPLE_INTERVAL_SECONDS = 150;
const SIMILAR_FRAME_THRESHOLD = 0.85;
const FRAME_SIGNATURE_SIZE = 8;

export function isPausedVideo(video: HTMLVideoElement | null): boolean {
  return Boolean(video?.paused);
}

export function calculateFrameSampleTimes(
  duration: number,
  maxFrames = DEFAULT_SAMPLE_FRAME_CAP
) {
  if (!Number.isFinite(duration) || duration <= 0 || maxFrames <= 0) {
    return [];
  }

  if (duration <= SHORT_VIDEO_SECONDS) {
    return [Math.round(duration / 2)];
  }

  const sampleCount = Math.min(
    maxFrames,
    Math.max(3, Math.ceil(duration / TARGET_SAMPLE_INTERVAL_SECONDS))
  );
  const step = duration / sampleCount;

  return Array.from({ length: sampleCount }, (_, index) => {
    const midpoint = (index + 0.5) * step;
    const bounded = Math.min(duration - 0.5, Math.max(0.5, midpoint));
    return Math.round(bounded * 10) / 10;
  });
}

export function normalizeRequestedFrameTimes(
  sampleTimes: number[],
  duration: number,
  maxFrames = DEFAULT_SAMPLE_FRAME_CAP
) {
  if (!Array.isArray(sampleTimes) || maxFrames <= 0) {
    return [];
  }

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  const roundedTimes = sampleTimes
    .map((time) => Math.round(Number(time) * 10) / 10)
    .filter((time) => Number.isFinite(time) && time >= 0 && time < safeDuration);

  return Array.from(new Set(roundedTimes))
    .sort((left, right) => left - right)
    .slice(0, maxFrames);
}

export function calculateFrameSignatureSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);

  if (length === 0) {
    return 0;
  }

  const totalDifference = Array.from({ length }, (_, index) =>
    Math.abs(left[index] - right[index])
  ).reduce((sum, value) => sum + value, 0);

  return Math.max(0, Math.min(1, 1 - totalDifference / (length * 255)));
}

export function captureVideoFrame(
  video: HTMLVideoElement | null,
  options: CaptureVideoFrameOptions = {}
): string | null {
  if (!video) {
    return null;
  }

  const width = video.videoWidth || video.clientWidth;
  const height = video.videoHeight || video.clientHeight;

  if (!width || !height) {
    return null;
  }

  const canvas = document.createElement("canvas");
  const scale =
    options.maxWidth && width > options.maxWidth ? options.maxWidth / width : 1;
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(options.mimeType ?? "image/png", options.quality);
  } catch {
    return null;
  }
}

function waitForSeek(video: HTMLVideoElement, time: number) {
  return new Promise<void>((resolve) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve();
    }, 2500);

    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", onSeeked);
    };

    const onSeeked = () => {
      cleanup();
      resolve();
    };

    video.addEventListener("seeked", onSeeked);

    try {
      video.currentTime = time;
    } catch {
      cleanup();
      resolve();
    }
  });
}

function waitForFramePaint() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 80);
  });
}

function loadFrameImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to decode frame image."));
    image.src = dataUrl;
  });
}

async function buildFrameSignature(dataUrl: string) {
  const image = await loadFrameImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = FRAME_SIGNATURE_SIZE;
  canvas.height = FRAME_SIGNATURE_SIZE;
  const context = canvas.getContext("2d");

  if (!context) {
    return [];
  }

  context.drawImage(image, 0, 0, FRAME_SIGNATURE_SIZE, FRAME_SIGNATURE_SIZE);
  const pixels = context.getImageData(0, 0, FRAME_SIGNATURE_SIZE, FRAME_SIGNATURE_SIZE).data;
  const signature: number[] = [];

  for (let index = 0; index < pixels.length; index += 4) {
    signature.push(Math.round((pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3));
  }

  return signature;
}

export async function dedupeSimilarCapturedFrames(
  frames: CapturedVideoFrame[],
  threshold = SIMILAR_FRAME_THRESHOLD
) {
  const keptFrames: CapturedVideoFrame[] = [];
  const signatures: number[][] = [];

  for (const frame of frames) {
    try {
      const signature = await buildFrameSignature(frame.imageBase64);
      const isDuplicate = signatures.some(
        (keptSignature) =>
          calculateFrameSignatureSimilarity(keptSignature, signature) >= threshold
      );

      if (!isDuplicate) {
        keptFrames.push(frame);
        signatures.push(signature);
      }
    } catch {
      keptFrames.push(frame);
    }
  }

  return keptFrames;
}

export async function captureVideoFrameSeries(
  video: HTMLVideoElement | null,
  options: CaptureVideoFrameSeriesOptions = {}
): Promise<CapturedVideoFrame[]> {
  if (!video) {
    return [];
  }

  const duration = Number(video.duration);
  const requestedTimes = normalizeRequestedFrameTimes(
    options.sampleTimes ?? [],
    duration,
    options.maxFrames ?? DEFAULT_SAMPLE_FRAME_CAP
  );
  const times =
    requestedTimes.length > 0
      ? requestedTimes
      : calculateFrameSampleTimes(duration, options.maxFrames ?? DEFAULT_SAMPLE_FRAME_CAP);

  if (times.length === 0) {
    const imageBase64 = captureVideoFrame(video, options);
    return imageBase64 ? [{ time: Number(video.currentTime) || 0, imageBase64 }] : [];
  }

  const originalTime = Number(video.currentTime) || 0;
  const wasPaused = video.paused;
  const frames: CapturedVideoFrame[] = [];

  video.pause();

  try {
    for (const time of times) {
      await waitForSeek(video, time);
      await waitForFramePaint();

      const imageBase64 = captureVideoFrame(video, {
        maxWidth: options.maxWidth ?? 640,
        mimeType: options.mimeType ?? "image/jpeg",
        quality: options.quality ?? 0.68
      });

      if (imageBase64) {
        frames.push({ time, imageBase64 });
      }
    }
  } finally {
    await waitForSeek(video, originalTime);

    if (!wasPaused) {
      void video.play().catch(() => {
        return;
      });
    }
  }

  return dedupeSimilarCapturedFrames(frames);
}
