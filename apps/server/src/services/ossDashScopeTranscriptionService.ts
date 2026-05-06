import { createHmac, randomUUID } from "node:crypto";

interface UserOwnedOssConfig {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
  bucket: string;
  endpoint?: string;
}

interface OssDashScopeDeps {
  fetch?: typeof fetch;
  nowSeconds?: () => number;
  nowDate?: () => Date;
  randomId?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
}

const OSS_TEMP_PREFIX = "bilibili-ai-helper/tmp";
const OSS_SIGNED_URL_TTL_SECONDS = 10 * 60;

export interface DashScopeOssDiagnostics {
  uploadBytes: number;
  mimeType: string;
  model: string;
  objectKey?: string;
  ossEndpointHint?: string;
  taskId?: string;
  taskStatus?: string;
  resultUrl?: string;
  resultSummary?: unknown;
}

export class DashScopeOssTranscriptionError extends Error {
  constructor(message: string, readonly diagnostics: DashScopeOssDiagnostics) {
    super(message);
    this.name = "DashScopeOssTranscriptionError";
  }
}

function getDashScopeOrigin(baseUrl?: string) {
  if (!baseUrl) {
    return "https://dashscope.aliyuncs.com";
  }

  try {
    const parsed = new URL(baseUrl);

    if (parsed.hostname.includes("dashscope-intl.aliyuncs.com")) {
      return "https://dashscope-intl.aliyuncs.com";
    }
  } catch {
    return "https://dashscope.aliyuncs.com";
  }

  return "https://dashscope.aliyuncs.com";
}

function hmacSha1Base64(secret: string, value: string) {
  return createHmac("sha1", secret).update(value).digest("base64");
}

function encodeObjectKey(objectKey: string) {
  return objectKey.split("/").map(encodeURIComponent).join("/");
}

function buildOssHost(config: UserOwnedOssConfig) {
  if (!config.endpoint?.trim()) {
    return `${config.bucket}.${config.region}.aliyuncs.com`;
  }

  const endpoint = config.endpoint.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");

  return endpoint.includes(config.bucket) ? endpoint : `${config.bucket}.${endpoint}`;
}

function extractOssEndpointHint(message: string) {
  const endpoint = message.match(/<Endpoint>([^<]+)<\/Endpoint>/i)?.[1]?.trim();

  if (endpoint) {
    return endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }

  return undefined;
}

function withOssEndpointHint(config: UserOwnedOssConfig, endpoint: string) {
  const normalizedEndpoint = endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const region = normalizedEndpoint.match(/^(oss-[^.]+)\.aliyuncs\.com$/)?.[1] ?? config.region;

  return {
    ...config,
    region,
    endpoint: normalizedEndpoint
  };
}

function buildOssObjectUrl(config: UserOwnedOssConfig, objectKey: string) {
  return `https://${buildOssHost(config)}/${encodeObjectKey(objectKey)}`;
}

function signOssHeaderRequest({
  method,
  contentType = "",
  date,
  config,
  objectKey
}: {
  method: "PUT" | "DELETE";
  contentType?: string;
  date: string;
  config: UserOwnedOssConfig;
  objectKey: string;
}) {
  const canonicalResource = `/${config.bucket}/${objectKey}`;
  const stringToSign = `${method}\n\n${contentType}\n${date}\n${canonicalResource}`;
  const signature = hmacSha1Base64(config.accessKeySecret, stringToSign);

  return `OSS ${config.accessKeyId}:${signature}`;
}

function buildSignedGetUrl({
  config,
  objectKey,
  expires
}: {
  config: UserOwnedOssConfig;
  objectKey: string;
  expires: number;
}) {
  const canonicalResource = `/${config.bucket}/${objectKey}`;
  const signature = hmacSha1Base64(
    config.accessKeySecret,
    `GET\n\n\n${expires}\n${canonicalResource}`
  );
  const url = new URL(buildOssObjectUrl(config, objectKey));

  url.searchParams.set("OSSAccessKeyId", config.accessKeyId);
  url.searchParams.set("Expires", String(expires));
  url.searchParams.set("Signature", signature);

  return url.toString();
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

function readTextField(record: Record<string, unknown>) {
  const text = record.text;
  const transcript = record.transcript;

  if (typeof text === "string" && text.trim()) {
    return text.trim();
  }

  if (typeof transcript === "string" && transcript.trim()) {
    return transcript.trim();
  }

  return "";
}

function normalizeDashScopeTranscript(data: unknown): string {
  if (Array.isArray(data)) {
    return data.map(normalizeDashScopeTranscript).filter(Boolean).join("\n").trim();
  }

  if (!data || typeof data !== "object") {
    return "";
  }

  const record = data as Record<string, unknown>;
  const directText = readTextField(record);

  if (directText) {
    return directText;
  }

  const sentenceSources: unknown[] = [];

  if (Array.isArray(record.sentences)) {
    sentenceSources.push(...record.sentences);
  }

  if (Array.isArray(record.transcripts)) {
    for (const transcript of record.transcripts) {
      if (!transcript || typeof transcript !== "object") {
        continue;
      }

      const transcriptRecord = transcript as Record<string, unknown>;

      if (Array.isArray(transcriptRecord.sentences)) {
        sentenceSources.push(...transcriptRecord.sentences);
      } else {
        const transcriptText = readTextField(transcriptRecord);

        if (transcriptText) {
          sentenceSources.push({
            text: transcriptText
          });
        }
      }
    }
  }

  if (sentenceSources.length > 0) {
    return sentenceSources
      .map((sentence) => {
        if (!sentence || typeof sentence !== "object") {
          return "";
        }

        const sentenceRecord = sentence as Record<string, unknown>;
        const text = readTextField(sentenceRecord);

        if (!text) {
          return "";
        }

        const beginTime = Number(sentenceRecord.begin_time);
        const endTime = Number(sentenceRecord.end_time);

        if (Number.isFinite(beginTime) && Number.isFinite(endTime)) {
          return `[${formatTranscriptTimestamp(beginTime)} - ${formatTranscriptTimestamp(endTime)}] ${text}`;
        }

        return text;
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (record.output && typeof record.output === "object") {
    const outputText = normalizeDashScopeTranscript(record.output);

    if (outputText) {
      return outputText;
    }
  }

  if (Array.isArray(record.results)) {
    const resultText = normalizeDashScopeTranscript(record.results);

    if (resultText) {
      return resultText;
    }
  }

  return "";
}

function summarizeDashScopeResult(data: unknown): unknown {
  if (Array.isArray(data)) {
    return {
      type: "array",
      length: data.length,
      first: data.length > 0 ? summarizeDashScopeResult(data[0]) : undefined
    };
  }

  if (!data || typeof data !== "object") {
    return {
      type: typeof data
    };
  }

  const record = data as Record<string, unknown>;
  const summary: Record<string, unknown> = {
    keys: Object.keys(record).slice(0, 12)
  };

  if (typeof record.text === "string") {
    summary.textLength = record.text.trim().length;
  }

  if (typeof record.transcript === "string") {
    summary.transcriptLength = record.transcript.trim().length;
  }

  if (Array.isArray(record.transcripts)) {
    summary.transcriptsLength = record.transcripts.length;
    const firstTranscript = record.transcripts[0];

    if (firstTranscript && typeof firstTranscript === "object") {
      const first = firstTranscript as Record<string, unknown>;
      summary.firstTranscriptKeys = Object.keys(first).slice(0, 12);

      if (typeof first.text === "string") {
        summary.firstTranscriptTextLength = first.text.trim().length;
      }

      if (typeof first.transcript === "string") {
        summary.firstTranscriptTranscriptLength = first.transcript.trim().length;
      }

      if (Array.isArray(first.sentences)) {
        summary.firstTranscriptSentencesLength = first.sentences.length;
      }
    }
  }

  if (Array.isArray(record.sentences)) {
    summary.sentencesLength = record.sentences.length;
  }

  if (record.output && typeof record.output === "object") {
    summary.output = summarizeDashScopeResult(record.output);
  }

  if (Array.isArray(record.results)) {
    summary.resultsLength = record.results.length;
  }

  return summary;
}

function getDashScopeTranscriptionModelCandidates(dashScopeModel?: string) {
  const configuredModels =
    dashScopeModel
      ?.split(/[\s,;，；]+/)
      .map((model) => model.trim())
      .filter(Boolean) ?? [];
  const fallbackModels = ["paraformer-v2", "sensevoice-v1", "paraformer-8k-v2"];

  return [...configuredModels, ...fallbackModels].filter(
    (model, index, models) => models.indexOf(model) === index
  );
}

function isDashScopeModelMissing(status: number, detail: string) {
  return status === 400 && /Model not exist|InvalidParameter/i.test(detail);
}

function formatModelErrors(errors: string[]) {
  return errors.length > 0 ? ` Tried models: ${errors.join(" | ")}` : "";
}

async function uploadObjectToOss({
  audioBuffer,
  mimeType,
  objectKey,
  oss,
  deps
}: {
  audioBuffer: Buffer;
  mimeType: string;
  objectKey: string;
  oss: UserOwnedOssConfig;
  deps: Required<OssDashScopeDeps>;
}) {
  const date = deps.nowDate().toUTCString();
  const response = await deps.fetch(buildOssObjectUrl(oss, objectKey), {
    method: "PUT",
    headers: {
      Authorization: signOssHeaderRequest({
        method: "PUT",
        contentType: mimeType,
        date,
        config: oss,
        objectKey
      }),
      "Content-Type": mimeType,
      Date: date
    },
    body: new Uint8Array(audioBuffer)
  });

  if (!response.ok) {
    throw new Error(`OSS upload failed with status ${response.status}: ${await response.text()}`);
  }
}

async function deleteObjectFromOss({
  objectKey,
  oss,
  deps
}: {
  objectKey: string;
  oss: UserOwnedOssConfig;
  deps: Required<OssDashScopeDeps>;
}) {
  const date = deps.nowDate().toUTCString();

  await deps.fetch(buildOssObjectUrl(oss, objectKey), {
    method: "DELETE",
    headers: {
      Authorization: signOssHeaderRequest({
        method: "DELETE",
        date,
        config: oss,
        objectKey
      }),
      Date: date
    }
  }).catch(() => undefined);
}

async function submitDashScopeTaskWithModel({
  signedAudioUrl,
  dashScopeApiKey,
  dashScopeModel,
  dashScopeBaseUrl,
  deps
}: {
  signedAudioUrl: string;
  dashScopeApiKey: string;
  dashScopeModel: string;
  dashScopeBaseUrl?: string;
  deps: Required<OssDashScopeDeps>;
}) {
  const endpoint = `${getDashScopeOrigin(dashScopeBaseUrl)}/api/v1/services/audio/asr/transcription`;
  const response = await deps.fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${dashScopeApiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable"
    },
    body: JSON.stringify({
      model: dashScopeModel,
      input: {
        file_urls: [signedAudioUrl]
      }
    })
  });

  if (!response.ok) {
    return {
      ok: false as const,
      status: response.status,
      detail: await response.text()
    };
  }

  const data = (await response.json()) as {
    output?: {
      task_id?: string;
    };
  };
  const taskId = data.output?.task_id;

  if (!taskId) {
    throw new Error("DashScope accepted the OSS transcription request, but returned no task id.");
  }

  return {
    ok: true as const,
    taskId
  };
}

async function submitDashScopeTask({
  signedAudioUrl,
  dashScopeApiKey,
  dashScopeModel,
  dashScopeBaseUrl,
  deps,
  diagnostics
}: {
  signedAudioUrl: string;
  dashScopeApiKey: string;
  dashScopeModel: string;
  dashScopeBaseUrl?: string;
  deps: Required<OssDashScopeDeps>;
  diagnostics: DashScopeOssDiagnostics;
}) {
  const modelErrors: string[] = [];

  for (const model of getDashScopeTranscriptionModelCandidates(dashScopeModel)) {
    const result = await submitDashScopeTaskWithModel({
      signedAudioUrl,
      dashScopeApiKey,
      dashScopeModel: model,
      dashScopeBaseUrl,
      deps
    });

    if (result.ok) {
      diagnostics.model = model;
      diagnostics.taskId = result.taskId;
      return result.taskId;
    }

    modelErrors.push(`${model}: ${result.status} ${result.detail.slice(0, 240)}`);

    if (!isDashScopeModelMissing(result.status, result.detail)) {
      throw new Error(
        `DashScope OSS transcription submit failed with status ${result.status}: ${result.detail}${formatModelErrors(modelErrors)}`
      );
    }
  }

  throw new Error(
    `DashScope OSS transcription submit failed because no configured or fallback model was accepted.${formatModelErrors(modelErrors)}`
  );
}

async function pollDashScopeTranscript({
  taskId,
  dashScopeApiKey,
  dashScopeBaseUrl,
  deps,
  diagnostics
}: {
  taskId: string;
  dashScopeApiKey: string;
  dashScopeBaseUrl?: string;
  deps: Required<OssDashScopeDeps>;
  diagnostics: DashScopeOssDiagnostics;
}) {
  const taskEndpoint = `${getDashScopeOrigin(dashScopeBaseUrl)}/api/v1/tasks/${encodeURIComponent(taskId)}`;

  for (let attempt = 0; attempt < 90; attempt += 1) {
    const taskResponse = await deps.fetch(taskEndpoint, {
      headers: {
        Authorization: `Bearer ${dashScopeApiKey}`
      }
    });

    if (!taskResponse.ok) {
      throw new Error(
        `DashScope OSS transcription poll failed with status ${taskResponse.status}: ${await taskResponse.text()}`
      );
    }

    const taskData = (await taskResponse.json()) as {
      output?: {
        task_status?: string;
        results?: Array<{
          transcription_url?: string;
        }>;
        message?: string;
      };
    };
    const taskStatus = taskData.output?.task_status;
    diagnostics.taskStatus = taskStatus;

    if (taskStatus === "FAILED" || taskStatus === "CANCELED") {
      throw new Error(
        `DashScope OSS transcription task ${taskStatus.toLowerCase()}: ${taskData.output?.message ?? "No detail returned."}`
      );
    }

    if (taskStatus === "SUCCEEDED") {
      const transcriptionUrl = taskData.output?.results?.find((item) => item.transcription_url)
        ?.transcription_url;

      if (!transcriptionUrl) {
        throw new Error("DashScope OSS transcription succeeded, but returned no transcript URL.");
      }

      diagnostics.resultUrl = transcriptionUrl;
      const transcriptResponse = await deps.fetch(transcriptionUrl);

      if (!transcriptResponse.ok) {
        throw new Error(
          `DashScope OSS transcription result fetch failed with status ${transcriptResponse.status}: ${await transcriptResponse.text()}`
        );
      }

      const resultJson = await transcriptResponse.json();
      diagnostics.resultSummary = summarizeDashScopeResult(resultJson);
      const transcriptText = normalizeDashScopeTranscript(resultJson);

      if (!transcriptText) {
        throw new DashScopeOssTranscriptionError(
          "DashScope OSS transcription result did not contain readable text.",
          diagnostics
        );
      }

      return transcriptText;
    }

    await deps.sleep(2000);
  }

  throw new Error("DashScope OSS transcription timed out.");
}

export async function transcribeDashScopeOssAudioBuffer({
  audioBuffer,
  mimeType,
  dashScopeApiKey,
  dashScopeModel = "paraformer-v2",
  dashScopeBaseUrl,
  oss
}: {
  audioBuffer: Buffer;
  mimeType: string;
  dashScopeApiKey: string;
  dashScopeModel?: string;
  dashScopeBaseUrl?: string;
  oss: UserOwnedOssConfig;
}, deps: OssDashScopeDeps = {}) {
  const resolvedDeps: Required<OssDashScopeDeps> = {
    fetch: deps.fetch ?? fetch,
    nowSeconds: deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)),
    nowDate: deps.nowDate ?? (() => new Date()),
    randomId: deps.randomId ?? randomUUID,
    sleep:
      deps.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  };
  const contentType = mimeType || "application/octet-stream";
  const objectKey = `${OSS_TEMP_PREFIX}/${resolvedDeps.randomId()}.${extensionForMimeType(contentType)}`;
  const diagnostics: DashScopeOssDiagnostics = {
    uploadBytes: audioBuffer.byteLength,
    mimeType: contentType,
    model: dashScopeModel || "paraformer-v2",
    objectKey
  };
  let uploaded = false;
  let resolvedOss = oss;

  try {
    try {
      await uploadObjectToOss({
        audioBuffer,
        mimeType: contentType,
        objectKey,
        oss: resolvedOss,
        deps: resolvedDeps
      });
    } catch (error) {
      const endpointHint = extractOssEndpointHint(error instanceof Error ? error.message : String(error));

      if (!endpointHint) {
        throw error;
      }

      diagnostics.ossEndpointHint = endpointHint;
      resolvedOss = withOssEndpointHint(oss, endpointHint);

      await uploadObjectToOss({
        audioBuffer,
        mimeType: contentType,
        objectKey,
        oss: resolvedOss,
        deps: resolvedDeps
      });
    }

    uploaded = true;

    const signedAudioUrl = buildSignedGetUrl({
      config: resolvedOss,
      objectKey,
      expires: resolvedDeps.nowSeconds() + OSS_SIGNED_URL_TTL_SECONDS
    });
    const taskId = await submitDashScopeTask({
      signedAudioUrl,
      dashScopeApiKey,
      dashScopeModel,
      dashScopeBaseUrl,
      deps: resolvedDeps,
      diagnostics
    });

    return await pollDashScopeTranscript({
      taskId,
      dashScopeApiKey,
      dashScopeBaseUrl,
      deps: resolvedDeps,
      diagnostics
    });
  } finally {
    if (uploaded) {
      await deleteObjectFromOss({
        objectKey,
        oss: resolvedOss,
        deps: resolvedDeps
      });
    }
  }
}
