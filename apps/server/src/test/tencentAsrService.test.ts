import { describe, expect, it, vi } from "vitest";
import {
  buildTencentCloudHeaders,
  TencentAsrTranscriptionError,
  transcribeTencentAudioBuffer
} from "../services/tencentAsrService";

describe("tencent ASR service", () => {
  it("builds TC3 signed headers for Tencent Cloud ASR", () => {
    const headers = buildTencentCloudHeaders({
      action: "CreateRecTask",
      payload: JSON.stringify({ SourceType: 1 }),
      credentials: {
        secretId: "secret-id",
        secretKey: "secret-key",
        engineModelType: "16k_zh_large"
      },
      timestampSeconds: 1700000000
    });

    expect(headers.Authorization).toContain("TC3-HMAC-SHA256 Credential=secret-id/");
    expect(headers.Authorization).toContain("SignedHeaders=content-type;host");
    expect(headers["X-TC-Action"]).toBe("CreateRecTask");
    expect(headers["X-TC-Version"]).toBe("2019-06-14");
  });

  it("splits audio, submits each chunk to Tencent ASR, and merges timestamped text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ Response: { Data: { TaskId: 1001 } } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Response: {
              Data: {
                Status: 2,
                StatusStr: "success",
                ResultDetail: [
                  { StartMs: 0, EndMs: 1200, FinalSentence: "第一段内容。" }
                ]
              }
            }
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ Response: { Data: { TaskId: 1002 } } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Response: {
              Data: {
                Status: 2,
                StatusStr: "success",
                ResultDetail: [
                  { StartMs: 500, EndMs: 1800, FinalSentence: "第二段内容。" }
                ]
              }
            }
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      );

    await expect(
      transcribeTencentAudioBuffer(
        {
          audioBuffer: Buffer.from([1, 2, 3]),
          mimeType: "audio/mp4",
          credentials: {
            secretId: "secret-id",
            secretKey: "secret-key",
            engineModelType: "16k_zh_large"
          },
          segmentSeconds: 300
        },
        {
          fetch: fetchMock,
          nowSeconds: () => 1700000000,
          sleep: async () => undefined,
          splitAudio: async () => [
            { buffer: Buffer.from([1]), startMs: 0 },
            { buffer: Buffer.from([2]), startMs: 300_000 }
          ]
        }
      )
    ).resolves.toBe("[00:00 - 00:01] 第一段内容。\n[05:00 - 05:01] 第二段内容。");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(firstBody).toMatchObject({
      EngineModelType: "16k_zh_large",
      SourceType: 1,
      ResTextFormat: 3,
      ChannelNum: 1,
      DataLen: 1
    });
  });

  it("falls back to Tencent's basic result format when detailed subtitles are empty", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ Response: { Data: { TaskId: 2001 } } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Response: {
              Data: {
                Status: 2,
                StatusStr: "success",
                Result: "",
                ResultDetail: []
              }
            }
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ Response: { Data: { TaskId: 2002 } } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Response: {
              Data: {
                Status: 2,
                StatusStr: "success",
                Result: "[0:1.500,0:3.200] fallback transcript\n",
                ResultDetail: []
              }
            }
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      );

    await expect(
      transcribeTencentAudioBuffer(
        {
          audioBuffer: Buffer.from([1, 2, 3]),
          mimeType: "audio/mp4",
          credentials: {
            secretId: "secret-id",
            secretKey: "secret-key",
            engineModelType: "16k_zh_large"
          },
          segmentSeconds: 300
        },
        {
          fetch: fetchMock,
          nowSeconds: () => 1700000000,
          sleep: async () => undefined,
          splitAudio: async () => [{ buffer: Buffer.from([1]), startMs: 300_000 }]
        }
      )
    ).resolves.toBe("[05:01 - 05:03] fallback transcript");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const detailedBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const fallbackBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(detailedBody.ResTextFormat).toBe(3);
    expect(fallbackBody.ResTextFormat).toBe(0);
  });

  it("includes diagnostics when Tencent accepts audio but returns no text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ Response: { Data: { TaskId: 3001 } } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Response: {
              Data: {
                Status: 2,
                StatusStr: "success",
                Result: "",
                ResultDetail: []
              }
            }
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ Response: { Data: { TaskId: 3002 } } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Response: {
              Data: {
                Status: 2,
                StatusStr: "success",
                Result: "",
                ResultDetail: []
              }
            }
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      );

    let thrown: unknown;

    try {
      await transcribeTencentAudioBuffer(
        {
          audioBuffer: Buffer.from([1, 2, 3]),
          mimeType: "audio/mp4",
          credentials: {
            secretId: "secret-id",
            secretKey: "secret-key",
            engineModelType: "16k_zh_large"
          },
          segmentSeconds: 300
        },
        {
          fetch: fetchMock,
          nowSeconds: () => 1700000000,
          sleep: async () => undefined,
          splitAudio: async () => [{ buffer: Buffer.from([1]), startMs: 0 }]
        }
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TencentAsrTranscriptionError);
    expect((thrown as TencentAsrTranscriptionError).diagnostics).toMatchObject({
      uploadBytes: 3,
      mimeType: "audio/mp4",
      engineModelType: "16k_zh_large",
      chunkCount: 1,
      chunks: [
        {
          bytes: 1,
          attempts: [
            { resTextFormat: 3, taskId: 3001, textLength: 0 },
            { resTextFormat: 0, taskId: 3002, textLength: 0 }
          ]
        }
      ]
    });
  });
});
