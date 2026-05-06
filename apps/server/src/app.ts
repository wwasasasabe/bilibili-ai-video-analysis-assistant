import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import Fastify from "fastify";
import analyzeRoutes from "./routes/analyze";
import dashScopeOssTranscriptionRoutes from "./routes/dashScopeOssTranscription";
import healthRoutes from "./routes/health";
import tencentTranscriptionRoutes from "./routes/tencentTranscription";

const MAX_AUDIO_UPLOAD_BYTES = 220 * 1024 * 1024;

export async function buildApp() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const extensionDistDir = path.resolve(currentDir, "../../extension/dist");
  const previewHtmlPath = path.join(extensionDistDir, "src/sidebar/index.html");

  const app = Fastify({
    logger: true,
    bodyLimit: MAX_AUDIO_UPLOAD_BYTES
  });
  await app.register(cors, {
    origin: true
  });
  const parseAudioBuffer = (
    _request: unknown,
    body: string | Buffer,
    done: (error: Error | null, body?: string | Buffer) => void
  ) => {
    done(null, body);
  };

  app.addContentTypeParser(
    ["application/octet-stream", "video/mp4"],
    {
      parseAs: "buffer",
      bodyLimit: MAX_AUDIO_UPLOAD_BYTES
    },
    parseAudioBuffer
  );
  app.addContentTypeParser(
    /^audio\/.+/,
    {
      parseAs: "buffer",
      bodyLimit: MAX_AUDIO_UPLOAD_BYTES
    },
    parseAudioBuffer
  );

  app.get("/", async (_request, reply) => {
    const html = await readFile(previewHtmlPath, "utf-8");
    reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/assets/:file", async (request, reply) => {
    const file = (request.params as { file: string }).file;
    const assetPath = path.join(extensionDistDir, "assets", file);
    const buffer = await readFile(assetPath);
    const ext = path.extname(assetPath).toLowerCase();

    if (ext === ".js") {
      reply.type("application/javascript; charset=utf-8");
    } else if (ext === ".css") {
      reply.type("text/css; charset=utf-8");
    }

    reply.send(buffer);
  });

  app.register(healthRoutes);
  app.register(analyzeRoutes);
  app.register(dashScopeOssTranscriptionRoutes);
  app.register(tencentTranscriptionRoutes);
  return app;
}
