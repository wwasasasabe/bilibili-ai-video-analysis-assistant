import { describe, expect, it, vi } from "vitest";
import { MAX_SUPPORTED_VIDEO_DURATION_SECONDS, isSupportedVideoDuration } from "@app/shared";
import {
  buildQuickSummaryPrompt,
  buildSummaryPrompt,
  buildMindmapPrompt,
  buildProviderEndpoint,
  buildTranscriptionEndpoint,
  createUserContent,
  requestAudioTranscription,
  trimConversationHistory
} from "../lib/provider";

function timestamp(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function buildLongTimestampedTranscript() {
  return Array.from({ length: 37 }, (_, index) => {
    const start = index * 300;
    const end = Math.min(start + 299, MAX_SUPPORTED_VIDEO_DURATION_SECONDS);

    return `[${timestamp(start)} - ${timestamp(end)}] topic-${index} ${"detail ".repeat(1_600)}`;
  }).join("\n");
}

describe("buildProviderEndpoint", () => {
  it("appends the OpenAI-compatible endpoint for bare provider URLs", () => {
    expect(buildProviderEndpoint("https://api.deepseek.com")).toBe(
      "https://api.deepseek.com/v1/chat/completions"
    );
  });

  it("reuses a full chat completions endpoint without appending twice", () => {
    expect(buildProviderEndpoint("https://api.example.com/v1/chat/completions")).toBe(
      "https://api.example.com/v1/chat/completions"
    );
  });

  it("builds an audio transcription endpoint from chat provider URLs", () => {
    expect(buildTranscriptionEndpoint("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/audio/transcriptions"
    );
    expect(buildTranscriptionEndpoint("https://api.example.com/v1/chat/completions")).toBe(
      "https://api.example.com/v1/audio/transcriptions"
    );
  });

  it("posts audio data to the provider transcription endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "hello transcript" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestAudioTranscription({
        providerConfig: {
          provider: "custom",
          baseUrl: "https://api.example.com/v1/chat/completions",
          apiKey: "test-key",
          model: "gpt-4o-mini",
          transcriptionModel: "whisper-1",
          visionEnabled: true
        },
        audioBase64: "data:audio/mp4;base64,AAAA"
      })
    ).resolves.toBe("hello transcript");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key"
        }),
        body: expect.any(FormData)
      })
    );
  });

  it("uploads audio blobs to the Tencent ASR backend when selected as the speech provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          transcriptText: "[00:00 - 00:01] 第一段内容\n[00:01 - 00:02] 第二段内容"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestAudioTranscription({
        providerConfig: {
          provider: "qwen",
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          apiKey: "dashscope-key",
          model: "qwen-plus",
          transcriptionModel: "paraformer-v2",
          transcriptionBackendUrl: "https://backend.example",
          asrProvider: "tencent",
          tencentSecretId: "tencent-id",
          tencentSecretKey: "tencent-secret",
          tencentEngineModelType: "16k_zh_large",
          visionEnabled: false
        },
        audioBlob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mp4" })
      })
    ).resolves.toBe("[00:00 - 00:01] 第一段内容\n[00:01 - 00:02] 第二段内容");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/transcribe/tencent"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Tencent-Secret-Id": "tencent-id",
          "X-Tencent-Secret-Key": "tencent-secret",
          "X-Tencent-Engine-Model-Type": "16k_zh_large",
          "Content-Type": "audio/mp4"
        }),
        body: expect.any(Blob)
      })
    );
  });

  it("surfaces Tencent ASR backend diagnostics when transcription is empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          transcriptText: "",
          debug: {
            uploadBytes: 1024,
            chunkCount: 1,
            chunks: [
              {
                bytes: 800,
                attempts: [
                  { resTextFormat: 3, taskId: 3001, textLength: 0 },
                  { resTextFormat: 0, taskId: 3002, textLength: 0 }
                ]
              }
            ]
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestAudioTranscription({
        providerConfig: {
          provider: "qwen",
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          apiKey: "dashscope-key",
          model: "qwen-plus",
          transcriptionModel: "paraformer-v2",
          transcriptionBackendUrl: "https://backend.example",
          asrProvider: "tencent",
          tencentSecretId: "tencent-id",
          tencentSecretKey: "tencent-secret",
          tencentEngineModelType: "16k_zh_large",
          visionEnabled: false
        },
        audioBlob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mp4" })
      })
    ).rejects.toThrow("uploadBytes");
  });

  it("uploads audio blobs to the DashScope OSS backend with user-owned OSS credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          transcriptText: "[00:00 - 00:01] OSS 转写内容"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestAudioTranscription({
        providerConfig: {
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
        },
        audioBlob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mp4" })
      })
    ).resolves.toBe("[00:00 - 00:01] OSS 转写内容");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/transcribe/dashscope-oss"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "audio/mp4",
          "X-DashScope-Api-Key": "dashscope-key",
          "X-DashScope-Model": "fun-asr",
          "X-OSS-Access-Key-Id": "oss-id",
          "X-OSS-Access-Key-Secret": "oss-secret",
          "X-OSS-Region": "oss-cn-hangzhou",
          "X-OSS-Bucket": "user-audio-bucket"
        }),
        body: expect.any(Blob)
      })
    );
  });

  it("requires a self-hosted backend URL for DashScope OSS transcription", async () => {
    await expect(
      requestAudioTranscription({
        providerConfig: {
          provider: "qwen",
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          apiKey: "dashscope-key",
          model: "qwen-plus",
          transcriptionModel: "paraformer-v2",
          asrProvider: "dashscope-oss",
          ossAccessKeyId: "oss-id",
          ossAccessKeySecret: "oss-secret",
          ossRegion: "oss-cn-hangzhou",
          ossBucket: "user-audio-bucket",
          visionEnabled: false
        },
        audioBlob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mp4" })
      })
    ).rejects.toThrow("self-hosted Backend URL");
  });

  it("surfaces DashScope OSS backend diagnostics when transcription is empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          transcriptText: "",
          debug: {
            uploadBytes: 3,
            model: "paraformer-v2",
            resultSummary: {
              transcriptsLength: 1,
              firstTranscriptSentencesLength: 0
            }
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestAudioTranscription({
        providerConfig: {
          provider: "qwen",
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          apiKey: "dashscope-key",
          model: "qwen-plus",
          transcriptionModel: "paraformer-v2",
          transcriptionBackendUrl: "https://backend.example",
          asrProvider: "dashscope-oss",
          ossAccessKeyId: "oss-id",
          ossAccessKeySecret: "oss-secret",
          ossRegion: "oss-cn-hangzhou",
          ossBucket: "user-audio-bucket",
          visionEnabled: false
        },
        audioBlob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mp4" })
      })
    ).rejects.toThrow("firstTranscriptSentencesLength");
  });

  it("adds endpoint context when transcription fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(
      requestAudioTranscription({
        providerConfig: {
          provider: "custom",
          baseUrl: "https://api.example.com/v1",
          apiKey: "test-key",
          model: "gpt-4o-mini",
          transcriptionModel: "whisper-1",
          visionEnabled: false
        },
        audioBase64: "data:audio/mp4;base64,AAAA"
      })
    ).rejects.toThrow("Unable to reach transcription endpoint");
  });

  it("builds an episode-aware mind map prompt with multiple layout options", () => {
    const prompt = buildMindmapPrompt(
      {
        videoId: "BV1",
        title: "TypeScript 实战",
        description: "",
        uploader: "Author",
        currentTime: 15,
        pageNumber: 3,
        episodeTitle: "组合式 API",
        transcriptText: "第一部分：响应式。第二部分：组合式函数。"
      },
      "zh",
      [],
      "请只关注当前选集。"
    );

    expect(prompt).toContain("当前选集");
    expect(prompt).toContain("P3 - 组合式 API");
    expect(prompt).toContain("tree");
    expect(prompt).toContain("timeline");
    expect(prompt).toContain("cluster");
    expect(prompt).toContain("comparison");
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("每个节点文案都要短、准、自然");
  });

  it("uses audio first, subtitles second, and OCR only as a final supplement for mind maps", () => {
    const prompt = buildMindmapPrompt(
      {
        videoId: "BV1",
        title: "CET-6 vocabulary lesson",
        description: "",
        uploader: "Teacher",
        currentTime: 60,
        subtitleText: "short current subtitle",
        transcriptText: "[00:00 - 00:30] full speech transcript with lesson details"
      },
      "en",
      [],
      ""
    );

    expect(prompt).toContain("Speech transcript is the primary source");
    expect(prompt).toContain("subtitles are only supporting evidence");
    expect(prompt).toContain("OCR is a final supplement");
    expect(prompt).toContain("only when the model can identify readable learning content");
    expect(prompt).toContain("do not replace or contradict the speech transcript");
  });

  it("discourages defaulting to tree for parallel sections", () => {
    const prompt = buildMindmapPrompt(
      {
        videoId: "BV1",
        title: "Linear Algebra Chapter 1",
        description: "",
        uploader: "Author",
        currentTime: 15,
        pageNumber: 4,
        episodeTitle: "Determinants",
        transcriptText: "Definition. Properties. Methods. Special cases."
      },
      "en",
      [],
      "Focus on the current episode."
    );

    expect(prompt).toContain("Do not use tree as the default layout.");
    expect(prompt).toContain("Prefer cluster when the content is organized as several parallel sections");
  });

  it("uses the full transcript and asks for broad vocabulary coverage in word lessons", () => {
    const prompt = buildMindmapPrompt(
      {
        videoId: "BV1",
        title: "CET-6 vocabulary lesson",
        description: "A lesson with many important English words.",
        uploader: "Teacher",
        currentTime: 72,
        subtitleText: "alleviate v. reduce pain or stress",
        transcriptText:
          "[00:00 - 01:20] alleviate means to make pain or stress less severe.\n" +
          "[01:20 - 02:40] ambiguous means unclear or having more than one meaning.\n" +
          "[02:40 - 04:00] anticipate means to expect something before it happens.\n" +
          "[04:00 - 05:10] apprehend means to understand or arrest.\n" +
          "[05:10 - 06:30] explicit means clear, direct, and not hidden."
      },
      "en",
      [],
      ""
    );

    expect(prompt).toContain("[04:00 - 05:10] apprehend");
    expect(prompt).not.toContain("Subtitle or transcript: alleviate v. reduce pain or stress");
    expect(prompt).toContain("vocabulary");
    expect(prompt).toContain("English headwords");
    expect(prompt).toContain("Do not keep only a few sample words");
  });

  it("keeps OCR supplemental instead of making it the primary source when transcripts are missing", () => {
    const prompt = buildMindmapPrompt(
      {
        videoId: "BV1",
        title: "CET-6 vocabulary lesson",
        description: "",
        uploader: "Teacher",
        currentTime: 260,
        duration: 2591
      },
      "en",
      [],
      ""
    );

    expect(prompt).toContain("No subtitle available");
    expect(prompt).toContain("Speech transcript is the primary source");
    expect(prompt).toContain("OCR is a final supplement");
    expect(prompt).toContain("deduplicate repeated OCR items");
  });

  it("builds a multi-image vision message for sampled video frames", () => {
    const content = createUserContent(
      "Read these sampled frames.",
      ["data:image/jpeg;base64,one", "data:image/jpeg;base64,two"],
      true
    );

    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(3);

    if (Array.isArray(content)) {
      expect(content[0]).toEqual({ type: "text", text: "Read these sampled frames." });
      expect(content[1]).toEqual({
        type: "image_url",
        image_url: { url: "data:image/jpeg;base64,one" }
      });
      expect(content[2]).toEqual({
        type: "image_url",
        image_url: { url: "data:image/jpeg;base64,two" }
      });
    }
  });

  it("asks for more precise timeline summaries", () => {
    const prompt = buildSummaryPrompt(
      {
        videoId: "BV1",
        title: "n阶行列式",
        description: "",
        uploader: "Author",
        currentTime: 0,
        duration: 1723,
        transcriptText: "先讲定义，再讲性质，再讲展开。",
        noteText: "重点关注定义、性质和展开。"
      },
      "zh",
      [],
      "按知识点边界切分。"
    );

    expect(prompt).toContain("具体概念");
    expect(prompt).toContain("公式");
    expect(prompt).toContain("字幕、转录和笔记");
    expect(prompt).toContain("按知识点边界切分");
  });

  it("builds a quick summary prompt without timeline requirements", () => {
    const prompt = buildQuickSummaryPrompt(
      {
        videoId: "BV1",
        title: "Mapping basics",
        description: "",
        uploader: "Teacher",
        currentTime: 0,
        duration: 420,
        subtitleText: "Definitions, examples, and final notes."
      },
      "en",
      [],
      ""
    );

    expect(prompt).toContain("Quick Summary");
    expect(prompt).toContain("Do not create a timeline");
    expect(prompt).not.toContain("Timeline Analysis");
    expect(prompt).not.toContain("00:00 - 01:12");
  });

  it("uses the timestamped full transcript before the current subtitle for summaries", () => {
    const prompt = buildSummaryPrompt(
      {
        videoId: "BV1",
        title: "Determinants",
        description: "",
        uploader: "Author",
        currentTime: 60,
        duration: 120,
        subtitleText: "current subtitle only",
        transcriptText: "[00:00 - 00:10] definition\n[00:10 - 00:30] determinant example"
      },
      "en",
      [],
      ""
    );

    expect(prompt).toContain("[00:00 - 00:10] definition");
    expect(prompt).not.toContain("Subtitle or transcript: current subtitle only");
    expect(prompt).toContain("Timestamp rule");
    expect(prompt).toContain("Use those timestamps as the only evidence");
  });

  it("supports 3-hour videos by compacting long timestamped transcripts", () => {
    const prompt = buildSummaryPrompt(
      {
        videoId: "BV-long",
        title: "3-hour lesson",
        description: "",
        uploader: "Teacher",
        currentTime: 0,
        duration: MAX_SUPPORTED_VIDEO_DURATION_SECONDS,
        subtitleText: "current subtitle only",
        transcriptText: buildLongTimestampedTranscript()
      },
      "en",
      [],
      ""
    );

    expect(isSupportedVideoDuration(MAX_SUPPORTED_VIDEO_DURATION_SECONDS)).toBe(true);
    expect(isSupportedVideoDuration(MAX_SUPPORTED_VIDEO_DURATION_SECONDS + 1)).toBe(false);
    expect(prompt).toContain("Actual video duration: 03:00:00");
    expect(prompt).toContain("stable 3-hour video support");
    expect(prompt).toContain("topic-0");
    expect(prompt).toContain("topic-18");
    expect(prompt).toContain("topic-36");
    expect(prompt.length).toBeLessThan(150_000);
  });

  it("keeps the most recent conversation messages within the context window", () => {
    const trimmed = trimConversationHistory(
      [
        { role: "assistant", content: "第一轮回答".repeat(6) },
        { role: "user", content: "第二轮提问".repeat(6) },
        { role: "assistant", content: "第三轮回答".repeat(6) }
      ],
      130
    );

    expect(trimmed).toHaveLength(2);
    expect(trimmed[0]?.content).toContain("第二轮提问");
    expect(trimmed[1]?.content).toContain("第三轮回答");
  });
});
