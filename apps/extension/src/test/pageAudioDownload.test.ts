import { describe, expect, it, vi } from "vitest";
import { fetchBilibiliAudioDataUrlInPage } from "../lib/pageAudioDownload";

describe("page-context Bilibili audio download", () => {
  it("tries backup audio urls in the page context and returns a data url", async () => {
    const fetchMock = vi
      .fn()
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

    const result = await fetchBilibiliAudioDataUrlInPage(
      ["https://upos.example/primary.m4s", "https://upos.example/backup.m4s"],
      "https://www.bilibili.com/video/BV1dCoDB5Emu/"
    );

    expect(result).toMatchObject({
      byteLength: 3,
      mimeType: "audio/mp4",
      sourceUrl: "https://upos.example/backup.m4s"
    });
    expect(result.dataUrl).toBe("data:audio/mp4;base64,BAUG");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://upos.example/primary.m4s",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({
          Accept: "*/*",
          Range: "bytes=0-"
        }),
        referrer: "https://www.bilibili.com/video/BV1dCoDB5Emu/"
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://upos.example/backup.m4s",
      expect.any(Object)
    );
  });
});
