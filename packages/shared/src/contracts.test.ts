import { describe, expect, it } from "vitest";
import { customSkillSchema, providerConfigSchema } from "./schemas";

describe("customSkillSchema", () => {
  it("accepts a summary skill manifest", () => {
    const parsed = customSkillSchema.parse({
      id: "summary-coach",
      name: "Summary Coach",
      version: "1.0.0",
      targets: ["summary"],
      prompt: "Return crisp learning-focused summaries."
    });

    expect(parsed.targets).toEqual(["summary"]);
  });
});

describe("providerConfigSchema", () => {
  it("accepts user-owned OSS credentials for DashScope OSS transcription", () => {
    const parsed = providerConfigSchema.parse({
      provider: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: "dashscope-key",
      model: "qwen-plus",
      transcriptionModel: "fun-asr",
      transcriptionBackendUrl: "https://backend.example",
      asrProvider: "dashscope-oss",
      ossAccessKeyId: "oss-id",
      ossAccessKeySecret: "oss-secret",
      ossRegion: "oss-cn-hangzhou",
      ossBucket: "user-audio-bucket",
      visionEnabled: false
    });

    expect(parsed.asrProvider).toBe("dashscope-oss");
    expect(parsed.transcriptionBackendUrl).toBe("https://backend.example");
    expect(parsed.ossBucket).toBe("user-audio-bucket");
  });
});
