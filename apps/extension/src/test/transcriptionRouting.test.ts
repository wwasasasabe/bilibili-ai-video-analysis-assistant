import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "@app/shared";
import { getBilibiliAudioTranscriptionInputMode } from "../lib/transcriptionRouting";

const baseConfig: ProviderConfig = {
  provider: "qwen",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKey: "key",
  model: "qwen-plus",
  visionEnabled: true,
  asrProvider: "auto"
};

describe("getBilibiliAudioTranscriptionInputMode", () => {
  it("routes DashScope OSS transcription through an uploaded audio blob", () => {
    expect(
      getBilibiliAudioTranscriptionInputMode({
        ...baseConfig,
        asrProvider: "dashscope-oss"
      })
    ).toBe("blob");
  });

  it("routes Tencent Cloud ASR through an uploaded audio blob", () => {
    expect(
      getBilibiliAudioTranscriptionInputMode({
        ...baseConfig,
        asrProvider: "tencent"
      })
    ).toBe("blob");
  });

  it("routes OpenAI-compatible upload transcription through base64 upload", () => {
    expect(
      getBilibiliAudioTranscriptionInputMode({
        ...baseConfig,
        asrProvider: "openai"
      })
    ).toBe("base64");
  });
});
