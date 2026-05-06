import { describe, expect, it } from "vitest";
import { buildApp } from "../app";

describe("analyze route", () => {
  it("returns cors headers for browser requests", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "OPTIONS",
      url: "/analyze",
      headers: {
        origin: "http://127.0.0.1:4173",
        "access-control-request-method": "POST"
      }
    });

    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:4173");
    await app.close();
  });

  it("rejects Tencent transcription uploads without user-owned Tencent credentials", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/transcribe/tencent",
      headers: {
        "content-type": "audio/mp4"
      },
      payload: Buffer.from([1, 2, 3])
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Missing Tencent SecretId or SecretKey."
    });
    await app.close();
  });

  it("rejects DashScope OSS uploads without user-owned OSS credentials", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/transcribe/dashscope-oss",
      headers: {
        "content-type": "audio/mp4",
        "x-dashscope-api-key": "dashscope-key"
      },
      payload: Buffer.from([1, 2, 3])
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Missing OSS AccessKeyId, AccessKeySecret, region, or bucket."
    });
    await app.close();
  });
});
