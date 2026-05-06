import { describe, expect, it, vi } from "vitest";
import {
  DashScopeOssTranscriptionError,
  transcribeDashScopeOssAudioBuffer
} from "../services/ossDashScopeTranscriptionService";

const baseRequest = {
  audioBuffer: Buffer.from([1, 2, 3]),
  mimeType: "audio/mp4",
  dashScopeApiKey: "dashscope-key",
  dashScopeModel: "paraformer-v2",
  oss: {
    accessKeyId: "oss-id",
    accessKeySecret: "oss-secret",
    region: "oss-cn-hangzhou",
    bucket: "user-audio-bucket"
  }
};

const fixedDeps = {
  nowSeconds: () => 1700000000,
  nowDate: () => new Date("2026-05-06T00:00:00.000Z"),
  randomId: () => "fixed-id",
  sleep: async () => undefined
};

describe("OSS + DashScope transcription service", () => {
  it("uploads user audio to user-owned OSS, submits the signed URL to DashScope, and deletes the temporary object", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({
          output: {
            task_id: "task-1"
          }
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          output: {
            task_status: "SUCCEEDED",
            results: [
              {
                transcription_url: "https://dashscope-result.example/result.json"
              }
            ]
          }
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          transcripts: [
            {
              sentences: [
                { begin_time: 0, end_time: 1200, text: "first sentence" },
                { begin_time: 1200, end_time: 2600, text: "second sentence" }
              ]
            }
          ]
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      transcribeDashScopeOssAudioBuffer(baseRequest, {
        fetch: fetchMock,
        ...fixedDeps
      })
    ).resolves.toBe("[00:00 - 00:01] first sentence\n[00:01 - 00:02] second sentence");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://user-audio-bucket.oss-cn-hangzhou.aliyuncs.com/bilibili-ai-helper/tmp/fixed-id.m4a",
      expect.objectContaining({
        method: "PUT",
        body: expect.any(Uint8Array),
        headers: expect.objectContaining({
          Authorization: expect.stringContaining("OSS oss-id:"),
          "Content-Type": "audio/mp4"
        })
      })
    );
    const firstRequestOptions = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(Array.from(firstRequestOptions.body as Uint8Array)).toEqual([1, 2, 3]);

    const dashScopeBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(dashScopeBody).toMatchObject({
      model: "paraformer-v2",
      input: {
        file_urls: [expect.stringContaining("OSSAccessKeyId=oss-id")]
      }
    });
    const signedAudioUrl = new URL(dashScopeBody.input.file_urls[0]);
    expect(signedAudioUrl.pathname).toBe("/bilibili-ai-helper/tmp/fixed-id.m4a");
    expect(signedAudioUrl.searchParams.get("Expires")).toBe("1700000600");
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({
      method: "DELETE"
    });
  });

  it("reads transcript fields returned by DashScope result files", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({
          output: {
            task_id: "task-1"
          }
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          output: {
            task_status: "SUCCEEDED",
            results: [{ transcription_url: "https://dashscope-result.example/result.json" }]
          }
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          transcripts: [
            {
              transcript: "plain transcript field"
            }
          ]
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      transcribeDashScopeOssAudioBuffer(baseRequest, {
        fetch: fetchMock,
        ...fixedDeps
      })
    ).resolves.toBe("plain transcript field");
  });

  it("falls back to supported DashScope models when the configured model does not exist", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(
        Response.json(
          {
            code: "InvalidParameter",
            message: "Model not exist."
          },
          { status: 400 }
        )
      )
      .mockResolvedValueOnce(
        Response.json({
          output: {
            task_id: "task-1"
          }
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          output: {
            task_status: "SUCCEEDED",
            results: [{ transcription_url: "https://dashscope-result.example/result.json" }]
          }
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          transcripts: [
            {
              transcript: "fallback model transcript"
            }
          ]
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      transcribeDashScopeOssAudioBuffer(
        {
          ...baseRequest,
          dashScopeModel: "fun-asr"
        },
        {
          fetch: fetchMock,
          ...fixedDeps
        }
      )
    ).resolves.toBe("fallback model transcript");

    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      model: "fun-asr"
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      model: "paraformer-v2"
    });
  });

  it("retries OSS upload with the bucket endpoint recommended by Aliyun", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          [
            '<?xml version="1.0" encoding="UTF-8"?>',
            "<Error>",
            "<Code>AccessDenied</Code>",
            "<Message>The bucket you are attempting to access must be addressed using the specified endpoint.</Message>",
            "<Endpoint>oss-cn-beijing.aliyuncs.com</Endpoint>",
            "</Error>"
          ].join("\n"),
          { status: 403 }
        )
      )
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({
          output: {
            task_id: "task-1"
          }
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          output: {
            task_status: "SUCCEEDED",
            results: [{ transcription_url: "https://dashscope-result.example/result.json" }]
          }
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          transcripts: [
            {
              transcript: "region retry transcript"
            }
          ]
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      transcribeDashScopeOssAudioBuffer(baseRequest, {
        fetch: fetchMock,
        ...fixedDeps
      })
    ).resolves.toBe("region retry transcript");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://user-audio-bucket.oss-cn-hangzhou.aliyuncs.com/bilibili-ai-helper/tmp/fixed-id.m4a"
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://user-audio-bucket.oss-cn-beijing.aliyuncs.com/bilibili-ai-helper/tmp/fixed-id.m4a"
    );

    const dashScopeBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(dashScopeBody.input.file_urls[0]).toContain(
      "user-audio-bucket.oss-cn-beijing.aliyuncs.com"
    );
    expect(fetchMock.mock.calls[5]?.[0]).toBe(
      "https://user-audio-bucket.oss-cn-beijing.aliyuncs.com/bilibili-ai-helper/tmp/fixed-id.m4a"
    );
  });

  it("includes diagnostics when DashScope returns no readable text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({
          output: {
            task_id: "task-1"
          }
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          output: {
            task_status: "SUCCEEDED",
            results: [{ transcription_url: "https://dashscope-result.example/result.json" }]
          }
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          transcripts: [
            {
              sentences: []
            }
          ]
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    let thrown: unknown;

    try {
      await transcribeDashScopeOssAudioBuffer(baseRequest, {
        fetch: fetchMock,
        ...fixedDeps
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DashScopeOssTranscriptionError);
    expect((thrown as DashScopeOssTranscriptionError).diagnostics).toMatchObject({
      uploadBytes: 3,
      mimeType: "audio/mp4",
      model: "paraformer-v2",
      taskId: "task-1",
      taskStatus: "SUCCEEDED",
      resultSummary: {
        transcriptsLength: 1,
        firstTranscriptSentencesLength: 0
      }
    });
  });
});
