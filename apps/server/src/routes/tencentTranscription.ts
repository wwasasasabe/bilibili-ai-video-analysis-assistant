import type { FastifyInstance } from "fastify";
import {
  TencentAsrTranscriptionError,
  transcribeTencentAudioBuffer
} from "../services/tencentAsrService";

function readHeader(headers: Record<string, unknown>, name: string) {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : typeof value === "string" ? value : "";
}

export default async function tencentTranscriptionRoutes(app: FastifyInstance) {
  app.post("/api/transcribe/tencent", async (request, reply) => {
    const audioBuffer = request.body instanceof Buffer ? request.body : null;

    if (!audioBuffer || audioBuffer.byteLength === 0) {
      reply.code(400);
      return {
        error: "Missing audio payload."
      };
    }

    const secretId = readHeader(request.headers, "x-tencent-secret-id").trim();
    const secretKey = readHeader(request.headers, "x-tencent-secret-key").trim();
    const engineModelType =
      readHeader(request.headers, "x-tencent-engine-model-type").trim() || "16k_zh_large";
    const segmentSeconds = Number(readHeader(request.headers, "x-segment-seconds")) || 300;

    if (!secretId || !secretKey) {
      reply.code(400);
      return {
        error: "Missing Tencent SecretId or SecretKey."
      };
    }

    try {
      const transcriptText = await transcribeTencentAudioBuffer({
        audioBuffer,
        mimeType: request.headers["content-type"] ?? "application/octet-stream",
        credentials: {
          secretId,
          secretKey,
          engineModelType
        },
        segmentSeconds
      });

      return {
        transcriptText
      };
    } catch (error) {
      reply.code(500);

      if (error instanceof TencentAsrTranscriptionError) {
        return {
          error: error.message,
          debug: error.diagnostics
        };
      }

      return {
        error: error instanceof Error ? error.message : "Tencent ASR transcription failed."
      };
    }
  });
}
