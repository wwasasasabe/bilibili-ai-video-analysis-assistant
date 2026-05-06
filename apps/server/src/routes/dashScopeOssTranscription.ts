import type { FastifyInstance } from "fastify";
import {
  DashScopeOssTranscriptionError,
  transcribeDashScopeOssAudioBuffer
} from "../services/ossDashScopeTranscriptionService";

function readHeader(headers: Record<string, unknown>, name: string) {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : typeof value === "string" ? value : "";
}

export default async function dashScopeOssTranscriptionRoutes(app: FastifyInstance) {
  app.post("/api/transcribe/dashscope-oss", async (request, reply) => {
    const audioBuffer = request.body instanceof Buffer ? request.body : null;

    if (!audioBuffer || audioBuffer.byteLength === 0) {
      reply.code(400);
      return {
        error: "Missing audio payload."
      };
    }

    const dashScopeApiKey = readHeader(request.headers, "x-dashscope-api-key").trim();
    const dashScopeBaseUrl = readHeader(request.headers, "x-dashscope-base-url").trim();
    const dashScopeModel =
      readHeader(request.headers, "x-dashscope-model").trim() || "fun-asr";
    const ossAccessKeyId = readHeader(request.headers, "x-oss-access-key-id").trim();
    const ossAccessKeySecret = readHeader(request.headers, "x-oss-access-key-secret").trim();
    const ossRegion = readHeader(request.headers, "x-oss-region").trim();
    const ossBucket = readHeader(request.headers, "x-oss-bucket").trim();
    const ossEndpoint = readHeader(request.headers, "x-oss-endpoint").trim();

    if (!dashScopeApiKey) {
      reply.code(400);
      return {
        error: "Missing DashScope API Key."
      };
    }

    if (!ossAccessKeyId || !ossAccessKeySecret || !ossRegion || !ossBucket) {
      reply.code(400);
      return {
        error: "Missing OSS AccessKeyId, AccessKeySecret, region, or bucket."
      };
    }

    try {
      const transcriptText = await transcribeDashScopeOssAudioBuffer({
        audioBuffer,
        mimeType: request.headers["content-type"] ?? "application/octet-stream",
        dashScopeApiKey,
        dashScopeModel,
        dashScopeBaseUrl,
        oss: {
          accessKeyId: ossAccessKeyId,
          accessKeySecret: ossAccessKeySecret,
          region: ossRegion,
          bucket: ossBucket,
          endpoint: ossEndpoint || undefined
        }
      });

      if (!transcriptText.trim()) {
        reply.code(500);
        return {
          error: "DashScope OSS transcription backend returned no readable transcript text."
        };
      }

      return {
        transcriptText
      };
    } catch (error) {
      reply.code(500);

      if (error instanceof DashScopeOssTranscriptionError) {
        return {
          error: error.message,
          debug: error.diagnostics
        };
      }

      return {
        error: error instanceof Error ? error.message : "DashScope OSS transcription failed."
      };
    }
  });
}
