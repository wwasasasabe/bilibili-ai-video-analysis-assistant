import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTranscriptText,
  extractPageNumber,
  extractAudioUrlsFromScripts,
  isBilibiliVideoPage,
  pickCurrentPageEntry,
  readBilibiliNoteText,
  readCurrentEpisodeTitle,
  readCurrentAudioUrls,
  readLivePageContext
} from "../lib/bilibili";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("isBilibiliVideoPage", () => {
  it("matches watch pages", () => {
    expect(isBilibiliVideoPage("https://www.bilibili.com/video/BV1xx411c7mD")).toBe(true);
  });
});

describe("extractPageNumber", () => {
  it("reads the selected page number from the url", () => {
    expect(
      extractPageNumber(
        "https://www.bilibili.com/video/BV1h7pteyEww?spm_id_from=333.788.videopod.episodes&p=3"
      )
    ).toBe(3);
  });

  it("returns undefined when no page number is present", () => {
    expect(extractPageNumber("https://www.bilibili.com/video/BV1h7pteyEww")).toBeUndefined();
  });
});

describe("pickCurrentPageEntry", () => {
  it("selects the current episode by page number", () => {
    const entry = pickCurrentPageEntry(
      [
        { page: 1, part: "线性代数视频2.0版 说明", duration: 201 },
        { page: 2, part: "1.1 二三阶行列式", duration: 1641 },
        { page: 3, part: "1.2 排列与逆序", duration: 1723 }
      ],
      3
    );

    expect(entry).toMatchObject({
      page: 3,
      part: "1.2 排列与逆序",
      duration: 1723
    });
  });
});

describe("buildTranscriptText", () => {
  it("keeps subtitle timestamps so summary ranges can match video frames", () => {
    expect(
      buildTranscriptText([
        { from: 0.2, to: 4.9, content: "介绍二阶行列式" },
        { from: 5.1, to: 12.8, content: "讲解对角线法则" }
      ])
    ).toBe("[00:00 - 00:04] 介绍二阶行列式\n[00:05 - 00:12] 讲解对角线法则");
  });
});

describe("extractAudioUrlsFromScripts", () => {
  it("extracts Bilibili dash audio URLs from page scripts", () => {
    document.body.innerHTML = `
      <script>
        window.__playinfo__ = {
          "data": {
            "dash": {
              "audio": [
                {
                  "id": 30280,
                  "baseUrl": "https://upos-sz-mirrorcos.bilivideo.com/audio-audio1.m4s",
                  "backupUrl": ["https://upos-sz-mirrorcos.bilivideo.com/audio-backup.m4s"]
                }
              ],
              "video": [
                { "baseUrl": "https://upos-sz-mirrorcos.bilivideo.com/video.m4s" }
              ]
            }
          }
        };
      </script>
    `;

    expect(extractAudioUrlsFromScripts(document)).toEqual([
      "https://upos-sz-mirrorcos.bilivideo.com/audio-audio1.m4s",
      "https://upos-sz-mirrorcos.bilivideo.com/audio-backup.m4s"
    ]);
  });
});

describe("readCurrentEpisodeTitle", () => {
  it("prefers the active episode title from the page dom", () => {
    document.body.innerHTML = `
      <div class="video-pod">
        <div class="video-pod__item">
          <span class="title-txt">1.1 二三阶行列式</span>
        </div>
        <div class="video-pod__item active">
          <span class="title-txt">1.2 排列与逆序</span>
        </div>
      </div>
    `;

    expect(readCurrentEpisodeTitle(document)).toBe("1.2 排列与逆序");
  });
});

describe("readBilibiliNoteText", () => {
  it("extracts readable note content from the note panel", () => {
    document.body.innerHTML = `
      <section class="video-note-panel">
        <div class="ql-editor">
          <p>这节主要讲排列与逆序，先解释什么是排列，再解释逆序数的概念。</p>
          <p>做摘要时要重点保留定义、例题和逆序奇偶性的判断方法。</p>
        </div>
      </section>
    `;

    expect(readBilibiliNoteText(document)).toContain("排列与逆序");
    expect(readBilibiliNoteText(document)).toContain("逆序奇偶性");
  });
});

describe("readLivePageContext", () => {
  it("loads subtitles for the current selected episode cid instead of stale page scripts", async () => {
    document.title = "线性代数";
    document.body.innerHTML = `
      <h1>线性代数教学视频 2.0 版</h1>
      <script>
        window.__INITIAL_STATE__ = {
          "subtitle_url":"https://subtitle.example/p1.json"
        };
      </script>
    `;

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("/x/web-interface/view")) {
        return new Response(
          JSON.stringify({
            data: {
              cid: 111,
              pages: [
                { cid: 111, page: 1, part: "说明", duration: 201 },
                { cid: 555, page: 5, part: "1.4 行列式的性质", duration: 3784 }
              ]
            }
          })
        );
      }

      if (url.includes("/x/player/v2")) {
        expect(url).toContain("cid=555");
        return new Response(
          JSON.stringify({
            data: {
              subtitle: {
                subtitles: [{ subtitle_url: "https://subtitle.example/p5.json" }]
              }
            }
          })
        );
      }

      if (url === "https://subtitle.example/p5.json") {
        return new Response(
          JSON.stringify({
            body: [{ from: 12, to: 18, content: "第五集正在讲行列式的性质" }]
          })
        );
      }

      if (url === "https://subtitle.example/p1.json") {
        return new Response(
          JSON.stringify({
            body: [{ from: 0, to: 4, content: "第一集旧字幕" }]
          })
        );
      }

      return new Response("{}", { status: 404 });
    });

    const context = await readLivePageContext(
      document,
      "https://www.bilibili.com/video/BV1h7pteyEww?spm_id_from=333.788.videopod.episodes&p=5"
    );

    expect(context).toMatchObject({
      pageNumber: 5,
      episodeTitle: "1.4 行列式的性质"
    });
    expect(context?.transcriptText).toContain("第五集正在讲行列式的性质");
    expect(context?.transcriptText).not.toContain("第一集旧字幕");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("cid=555"),
      expect.objectContaining({ credentials: "include" })
    );
  });
});

describe("readCurrentAudioUrls", () => {
  it("loads dash audio for the current selected episode cid instead of stale page scripts", async () => {
    document.body.innerHTML = `
      <script>
        window.__playinfo__ = {
          "data": {
            "dash": {
              "audio": [
                { "baseUrl": "https://upos.example/p1-audio.m4s" }
              ]
            }
          }
        };
      </script>
    `;

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("/x/web-interface/view")) {
        return new Response(
          JSON.stringify({
            data: {
              cid: 111,
              pages: [
                { cid: 111, page: 1, part: "说明", duration: 201 },
                { cid: 555, page: 5, part: "1.4 行列式的性质", duration: 3784 }
              ]
            }
          })
        );
      }

      if (url.includes("/x/player/playurl")) {
        expect(url).toContain("cid=555");
        return new Response(
          JSON.stringify({
            data: {
              dash: {
                audio: [
                  {
                    baseUrl: "https://upos.example/p5-audio.m4s",
                    backupUrl: ["https://upos.example/p5-audio-backup.m4s"]
                  }
                ]
              }
            }
          })
        );
      }

      return new Response("{}", { status: 404 });
    });

    const audioUrls = await readCurrentAudioUrls(
      document,
      "https://www.bilibili.com/video/BVaudioP5test?spm_id_from=333.788.videopod.episodes&p=5"
    );

    expect(audioUrls).toEqual([
      "https://upos.example/p5-audio.m4s",
      "https://upos.example/p5-audio-backup.m4s"
    ]);
    expect(audioUrls).not.toContain("https://upos.example/p1-audio.m4s");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("cid=555"),
      expect.objectContaining({ credentials: "include" })
    );
  });
});
