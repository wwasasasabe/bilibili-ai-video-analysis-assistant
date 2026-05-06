import { describe, expect, it, vi } from "vitest";
import { fetchBilibiliAudioBlob } from "../lib/bilibiliAudioDownload";

describe("Bilibili audio download", () => {
  it("uses a media-style range request when downloading Bilibili audio", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 206,
        headers: {
          "Content-Type": "audio/mp4"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const blob = await fetchBilibiliAudioBlob("https://upos.example/audio.m4s");

    expect(blob.size).toBe(3);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://upos.example/audio.m4s",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({
          Accept: "*/*",
          Range: "bytes=0-"
        }),
        referrer: "https://www.bilibili.com/"
      })
    );
  });

  it("uses cat-catch style headers with the current video page as referrer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 206,
        headers: {
          "Content-Type": "audio/mp4"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchBilibiliAudioBlob("https://upos.example/audio.m4s", {
      url: "https://upos.example/audio.m4s",
      pageUrl: "https://www.bilibili.com/video/BV1dCoDB5Emu/",
      requestHeaders: {
        "accept-language": "zh-CN,zh;q=0.9"
      }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://upos.example/audio.m4s",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({
          Accept: "*/*",
          "Accept-Language": "zh-CN,zh;q=0.9",
          Range: "bytes=0-"
        }),
        referrer: "https://www.bilibili.com/video/BV1dCoDB5Emu/"
      })
    );
  });

  it("retries without a Range header when a Bilibili mirror rejects range requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([7, 8, 9]), {
          status: 200,
          headers: {
            "Content-Type": "audio/mp4"
          }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const blob = await fetchBilibiliAudioBlob("https://upos.example/audio.m4s");

    expect(blob.size).toBe(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://upos.example/audio.m4s",
      expect.objectContaining({
        headers: expect.objectContaining({
          Range: "bytes=0-"
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://upos.example/audio.m4s",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Range: expect.any(String)
        })
      })
    );
  });

  it("tries backup audio urls when the primary Bilibili audio url is forbidden", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([4, 5, 6]), {
          status: 206,
          headers: {
            "Content-Type": "audio/mp4"
          }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const blob = await fetchBilibiliAudioBlob(
      ["https://upos.example/primary.m4s", "https://upos.example/backup.m4s"],
      {
        url: "https://upos.example/primary.m4s",
        pageUrl: "https://www.bilibili.com/video/BV1dCoDB5Emu/"
      }
    );

    expect(blob.size).toBe(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://upos.example/primary.m4s",
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "https://upos.example/backup.m4s",
      expect.any(Object)
    );
  });
});
