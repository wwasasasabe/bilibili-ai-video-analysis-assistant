import { createHmac, createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const TENCENT_ASR_ENDPOINT = "https://asr.tencentcloudapi.com";
const TENCENT_ASR_HOST = "asr.tencentcloudapi.com";
const TENCENT_ASR_SERVICE = "asr";
const TENCENT_ASR_VERSION = "2019-06-14";
const MAX_TENCENT_DATA_BYTES = 5 * 1024 * 1024;
const DEFAULT_SEGMENT_SECONDS = 300;

export interface TencentAsrCredentials {
  secretId: string;
  secretKey: string;
  engineModelType: string;
}

interface AudioChunk {
  buffer: Buffer;
  startMs: number;
}

export interface TencentAsrAttemptDiagnostic {
  resTextFormat: 0 | 3;
  taskId?: number;
  status?: number;
  statusStr?: string;
  resultLength?: number;
  resultDetailLength?: number;
  textLength?: number;
  error?: string;
}

export interface TencentAsrChunkDiagnostic {
  index: number;
  startMs: number;
  bytes: number;
  attempts: TencentAsrAttemptDiagnostic[];
}

export interface TencentAsrDiagnostics {
  uploadBytes: number;
  mimeType: string;
  segmentSeconds: number;
  engineModelType: string;
  chunkCount: number;
  chunks: TencentAsrChunkDiagnostic[];
}

interface TencentAsrDeps {
  fetch?: typeof fetch;
  splitAudio?: (audioBuffer: Buffer, mimeType: string, segmentSeconds: number) => Promise<AudioChunk[]>;
  nowSeconds?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class TencentAsrTranscriptionError extends Error {
  constructor(message: string, readonly diagnostics: TencentAsrDiagnostics) {
    super(message);
    this.name = "TencentAsrTranscriptionError";
  }
}

function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function formatDate(timestampSeconds: number) {
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 10);
}

export function buildTencentCloudHeaders({
  action,
  payload,
  credentials,
  timestampSeconds
}: {
  action: "CreateRecTask" | "DescribeTaskStatus";
  payload: string;
  credentials: TencentAsrCredentials;
  timestampSeconds: number;
}) {
  const date = formatDate(timestampSeconds);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${TENCENT_ASR_HOST}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    sha256(payload)
  ].join("\n");
  const credentialScope = `${date}/${TENCENT_ASR_SERVICE}/tc3_request`;
  const stringToSign = [
    "TC3-HMAC-SHA256",
    timestampSeconds.toString(),
    credentialScope,
    sha256(canonicalRequest)
  ].join("\n");
  const secretDate = hmac(`TC3${credentials.secretKey}`, date);
  const secretService = hmac(secretDate, TENCENT_ASR_SERVICE);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = createHmac("sha256", secretSigning).update(stringToSign).digest("hex");

  return {
    Authorization: `TC3-HMAC-SHA256 Credential=${credentials.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "Content-Type": "application/json; charset=utf-8",
    Host: TENCENT_ASR_HOST,
    "X-TC-Action": action,
    "X-TC-Version": TENCENT_ASR_VERSION,
    "X-TC-Timestamp": timestampSeconds.toString(),
    "X-TC-Region": "ap-shanghai"
  };
}

async function callTencentApi<T>(
  action: "CreateRecTask" | "DescribeTaskStatus",
  body: Record<string, unknown>,
  credentials: TencentAsrCredentials,
  deps: Required<Pick<TencentAsrDeps, "fetch" | "nowSeconds">>
) {
  const payload = JSON.stringify(body);
  const response = await deps.fetch(TENCENT_ASR_ENDPOINT, {
    method: "POST",
    headers: buildTencentCloudHeaders({
      action,
      payload,
      credentials,
      timestampSeconds: deps.nowSeconds()
    }),
    body: payload
  });

  if (!response.ok) {
    throw new Error(`Tencent ASR ${action} failed with status ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    Response?: T & {
      Error?: {
        Code?: string;
        Message?: string;
      };
    };
  };

  if (data.Response?.Error) {
    throw new Error(
      `Tencent ASR ${action} error ${data.Response.Error.Code ?? "Unknown"}: ${data.Response.Error.Message ?? "No detail"}`
    );
  }

  return data.Response as T;
}

function extensionForMimeType(mimeType: string) {
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) {
    return "mp3";
  }

  if (mimeType.includes("wav")) {
    return "wav";
  }

  if (mimeType.includes("mp4") || mimeType.includes("m4a")) {
    return "m4a";
  }

  return "bin";
}

function runFfmpeg(args: string[]) {
  const command = process.env.FFMPEG_PATH || "ffmpeg";

  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true
    });
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}. ${stderr.slice(-1200)}`));
      }
    });
  });
}

export async function splitAudioWithFfmpeg(
  audioBuffer: Buffer,
  mimeType: string,
  segmentSeconds = DEFAULT_SEGMENT_SECONDS
): Promise<AudioChunk[]> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "bilibili-ai-asr-"));
  const inputPath = path.join(workDir, `input.${extensionForMimeType(mimeType)}`);
  const outputPattern = path.join(workDir, "chunk_%03d.mp3");

  try {
    await writeFile(inputPath, audioBuffer);
    await runFfmpeg([
      "-y",
      "-i",
      inputPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-b:a",
      "48k",
      "-f",
      "segment",
      "-segment_time",
      String(segmentSeconds),
      "-reset_timestamps",
      "1",
      outputPattern
    ]);

    const files = (await readdir(workDir))
      .filter((file) => /^chunk_\d+\.mp3$/.test(file))
      .sort();

    return Promise.all(
      files.map(async (file, index) => ({
        buffer: await readFile(path.join(workDir, file)),
        startMs: index * segmentSeconds * 1000
      }))
    );
  } finally {
    await rm(workDir, {
      recursive: true,
      force: true
    });
  }
}

function formatTranscriptTimestamp(milliseconds: number) {
  const safeSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const two = (value: number) => value.toString().padStart(2, "0");

  if (hours > 0) {
    return `${two(hours)}:${two(minutes)}:${two(seconds)}`;
  }

  return `${two(minutes)}:${two(seconds)}`;
}

function parseTencentResultTime(value: string) {
  const parts = value.split(":").map((part) => Number(part));

  if (parts.length === 2 && parts.every(Number.isFinite)) {
    return Math.round((parts[0] * 60 + parts[1]) * 1000);
  }

  if (parts.length === 3 && parts.every(Number.isFinite)) {
    return Math.round((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000);
  }

  return 0;
}

function formatTencentBasicResult(result: string, offsetMs: number) {
  return result
    .split(/\r?\n/)
    .map((line) => {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        return "";
      }

      const timestampMatch = trimmedLine.match(
        /^\[([^,\]]+),([^\]]+)\]\s*(.+)$/
      );

      if (!timestampMatch) {
        return offsetMs > 0
          ? `[${formatTranscriptTimestamp(offsetMs)} - ${formatTranscriptTimestamp(offsetMs)}] ${trimmedLine}`
          : trimmedLine;
      }

      const start = offsetMs + parseTencentResultTime(timestampMatch[1]);
      const end = offsetMs + parseTencentResultTime(timestampMatch[2]);
      const text = timestampMatch[3].trim();

      if (!text) {
        return "";
      }

      return `[${formatTranscriptTimestamp(start)} - ${formatTranscriptTimestamp(end)}] ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

function formatTencentResult(data: unknown, offsetMs: number) {
  if (!data || typeof data !== "object") {
    return "";
  }

  const record = data as {
    Result?: unknown;
    ResultDetail?: unknown;
  };

  if (Array.isArray(record.ResultDetail) && record.ResultDetail.length > 0) {
    return record.ResultDetail
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }

        const detail = item as {
          FinalSentence?: unknown;
          WrittenText?: unknown;
          SliceSentence?: unknown;
          StartMs?: unknown;
          EndMs?: unknown;
        };
        const text = [
          detail.WrittenText,
          detail.FinalSentence,
          detail.SliceSentence
        ].find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";

        if (!text) {
          return "";
        }

        const start = offsetMs + Number(detail.StartMs ?? 0);
        const end = offsetMs + Number(detail.EndMs ?? detail.StartMs ?? 0);
        return `[${formatTranscriptTimestamp(start)} - ${formatTranscriptTimestamp(end)}] ${text}`;
      })
      .filter(Boolean)
      .join("\n");
  }

  if (typeof record.Result === "string") {
    return formatTencentBasicResult(record.Result, offsetMs).trim();
  }

  return "";
}

async function transcribeChunk(
  chunk: AudioChunk,
  credentials: TencentAsrCredentials,
  deps: Required<TencentAsrDeps>,
  resTextFormat: 0 | 3,
  diagnostic: TencentAsrAttemptDiagnostic
) {
  if (chunk.buffer.byteLength > MAX_TENCENT_DATA_BYTES) {
    throw new Error("A transcoded audio chunk exceeded Tencent Cloud ASR's 5MB SourceType=1 limit.");
  }

  const createResponse = await callTencentApi<{
    Data?: {
      TaskId?: number;
    };
  }>(
    "CreateRecTask",
    {
      EngineModelType: credentials.engineModelType,
      ChannelNum: 1,
      ResTextFormat: resTextFormat,
      SourceType: 1,
      Data: chunk.buffer.toString("base64"),
      DataLen: chunk.buffer.byteLength,
      ConvertNumMode: 1,
      FilterDirty: 0,
      FilterModal: 0,
      FilterPunc: 0
    },
    credentials,
    deps
  );
  const taskId = createResponse.Data?.TaskId;
  diagnostic.taskId = taskId;

  if (!taskId) {
    throw new Error("Tencent Cloud ASR did not return a TaskId.");
  }

  for (let attempt = 0; attempt < 90; attempt += 1) {
    const statusResponse = await callTencentApi<{
      Data?: {
        Status?: number;
        StatusStr?: string;
        ErrorMsg?: string;
        Result?: string;
        ResultDetail?: unknown[];
      };
    }>("DescribeTaskStatus", { TaskId: taskId }, credentials, deps);
    const data = statusResponse.Data;
    diagnostic.status = data?.Status;
    diagnostic.statusStr = data?.StatusStr;

    if (data?.Status === 2 || data?.StatusStr === "success") {
      diagnostic.resultLength = typeof data.Result === "string" ? data.Result.length : 0;
      diagnostic.resultDetailLength = Array.isArray(data.ResultDetail)
        ? data.ResultDetail.length
        : 0;
      const text = formatTencentResult(data, chunk.startMs);
      diagnostic.textLength = text.trim().length;
      return text;
    }

    if (data?.Status === 3 || data?.StatusStr === "failed") {
      throw new Error(data.ErrorMsg || "Tencent Cloud ASR task failed.");
    }

    await deps.sleep(2000);
  }

  throw new Error("Tencent Cloud ASR task timed out.");
}

async function transcribeChunkWithFallback(
  chunk: AudioChunk,
  credentials: TencentAsrCredentials,
  deps: Required<TencentAsrDeps>,
  chunkDiagnostic: TencentAsrChunkDiagnostic
) {
  const detailedDiagnostic: TencentAsrAttemptDiagnostic = {
    resTextFormat: 3
  };
  chunkDiagnostic.attempts.push(detailedDiagnostic);
  let detailedText = "";

  try {
    detailedText = await transcribeChunk(chunk, credentials, deps, 3, detailedDiagnostic);
  } catch (error) {
    detailedDiagnostic.error = error instanceof Error ? error.message : String(error);
    throw error;
  }

  if (detailedText.trim()) {
    return detailedText;
  }

  const basicDiagnostic: TencentAsrAttemptDiagnostic = {
    resTextFormat: 0
  };
  chunkDiagnostic.attempts.push(basicDiagnostic);

  try {
    return await transcribeChunk(chunk, credentials, deps, 0, basicDiagnostic);
  } catch (error) {
    basicDiagnostic.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

export async function transcribeTencentAudioBuffer({
  audioBuffer,
  mimeType,
  credentials,
  segmentSeconds = DEFAULT_SEGMENT_SECONDS
}: {
  audioBuffer: Buffer;
  mimeType: string;
  credentials: TencentAsrCredentials;
  segmentSeconds?: number;
}, deps: TencentAsrDeps = {}) {
  const resolvedDeps: Required<TencentAsrDeps> = {
    fetch: deps.fetch ?? fetch,
    splitAudio: deps.splitAudio ?? splitAudioWithFfmpeg,
    nowSeconds: deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)),
    sleep:
      deps.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  };
  const chunks = await resolvedDeps.splitAudio(audioBuffer, mimeType, segmentSeconds);
  const transcriptParts: string[] = [];
  const diagnostics: TencentAsrDiagnostics = {
    uploadBytes: audioBuffer.byteLength,
    mimeType,
    segmentSeconds,
    engineModelType: credentials.engineModelType,
    chunkCount: chunks.length,
    chunks: []
  };

  for (const [index, chunk] of chunks.entries()) {
    const chunkDiagnostic: TencentAsrChunkDiagnostic = {
      index,
      startMs: chunk.startMs,
      bytes: chunk.buffer.byteLength,
      attempts: []
    };
    diagnostics.chunks.push(chunkDiagnostic);
    const text = await transcribeChunkWithFallback(
      chunk,
      credentials,
      resolvedDeps,
      chunkDiagnostic
    );

    if (text.trim()) {
      transcriptParts.push(text.trim());
    }
  }

  const transcriptText = transcriptParts.join("\n").trim();

  if (!transcriptText) {
    throw new TencentAsrTranscriptionError(
      "Tencent Cloud ASR returned no readable transcript text.",
      diagnostics
    );
  }

  return transcriptText;
}
