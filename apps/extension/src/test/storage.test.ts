import { describe, expect, it } from "vitest";
import { normalizeProviderConfig } from "../lib/storage";

describe("normalizeProviderConfig", () => {
  it("defaults the custom provider to vision disabled", () => {
    expect(
      normalizeProviderConfig({
        provider: "custom",
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "demo-model"
      }).visionEnabled
    ).toBe(false);
  });

  it("forces speech transcription to DashScope OSS when normalizing", () => {
    expect(
      normalizeProviderConfig({
        provider: "qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "qwen-key",
        model: "qwen-plus",
        asrProvider: "tencent",
        tencentSecretId: "secret-id-123",
        tencentSecretKey: "secret-key-456",
        tencentEngineModelType: "16k_zh_en"
      })
    ).toMatchObject({
      asrProvider: "dashscope-oss",
      tencentSecretId: "secret-id-123",
      tencentSecretKey: "secret-key-456",
      tencentEngineModelType: "16k_zh_en"
    });
  });

  it("keeps user-owned OSS credentials when normalizing", () => {
    expect(
      normalizeProviderConfig({
        provider: "qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "qwen-key",
        model: "qwen-plus",
        asrProvider: "dashscope-oss",
        transcriptionBackendUrl: " https://backend.example ",
        ossAccessKeyId: "oss-id-123",
        ossAccessKeySecret: "oss-secret-456",
        ossRegion: "oss-cn-hangzhou",
        ossBucket: "user-bucket"
      })
    ).toMatchObject({
      asrProvider: "dashscope-oss",
      transcriptionBackendUrl: "https://backend.example",
      ossAccessKeyId: "oss-id-123",
      ossAccessKeySecret: "oss-secret-456",
      ossRegion: "oss-cn-hangzhou",
      ossBucket: "user-bucket"
    });
  });
});
