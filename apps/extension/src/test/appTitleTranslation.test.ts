import { describe, expect, it } from "vitest";
import {
  buildDetailedSummaryVisualCueInstruction,
  buildHistorySessionPreview,
  buildHistorySessionTitle,
  buildMindMapVisualCueInstruction,
  buildVisualCueCandidates,
  buildVisualCueFramePlan,
  buildVisualCueJudgementPrompt,
  isMeaningfulHistorySession,
  parseTimelineSummary,
  parseVisualCueJudgementResponse,
  removeHistorySessionById,
  shouldRenderTimelineSummaryCards,
  translateResultTitle
} from "../sidebar/App";

describe("translateResultTitle", () => {
  it("translates summary titles when switching languages", () => {
    expect(translateResultTitle("时间轴摘要", "en")).toBe("Timeline Summary");
    expect(translateResultTitle("快速摘要", "en")).toBe("Quick Summary");
    expect(translateResultTitle("细节摘要", "en")).toBe("Detailed Summary");
    expect(translateResultTitle("Quick Summary", "zh")).toBe("快速摘要");
    expect(translateResultTitle("Detailed Summary", "zh")).toBe("细节摘要");
    expect(translateResultTitle("对话结果", "en")).toBe("Answer Ready");
  });

  it("renders detailed summaries as timeline cards while quick summaries stay compact", () => {
    expect(shouldRenderTimelineSummaryCards("细节摘要")).toBe(true);
    expect(shouldRenderTimelineSummaryCards("Detailed Summary")).toBe(true);
    expect(shouldRenderTimelineSummaryCards("快速摘要")).toBe(false);
    expect(shouldRenderTimelineSummaryCards("Quick Summary")).toBe(false);
  });

  it("removes a selected history session without touching the rest", () => {
    const sessions = [
      { id: "a", title: "first" },
      { id: "b", title: "second" },
      { id: "c", title: "third" }
    ];

    expect(removeHistorySessionById(sessions, "b")).toEqual([
      { id: "a", title: "first" },
      { id: "c", title: "third" }
    ]);
  });

  it("does not treat the starter assistant message as a real history session", () => {
    expect(
      isMeaningfulHistorySession({
        id: "starter",
        createdAt: 1,
        updatedAt: 1,
        locale: "zh",
        videoTitle: "示例",
        resultTitle: "结果",
        resultBody:
          "可以先生成快速摘要，快速了解视频重点；也可以生成细节摘要，按语音转写的时间线一步步分析内容。",
        chatHistory: [
          {
            role: "assistant",
            content:
              "先生成快速摘要或细节摘要。快速摘要不带时间轴，细节摘要会按语音转写的时间线一步步分析内容。之后你也可以继续追问，或上传图片、Word 和代码。"
          }
        ]
      })
    ).toBe(false);
  });

  it("does not treat old starter assistant messages as real history sessions", () => {
    expect(
      isMeaningfulHistorySession({
        id: "legacy-starter",
        createdAt: 1,
        updatedAt: 1,
        locale: "zh",
        videoTitle: "",
        resultTitle: "结果",
        resultBody: "点击“摘要”后，这里会显示按整条视频时间顺序分段整理的中文摘要。",
        chatHistory: [
          {
            role: "assistant",
            content:
              "先生成摘要。现在的摘要会按照整条视频的时间轴顺序，一步一步分析内容。之后你也可以继续追问，或上传图片、Word 和代码。"
          }
        ]
      })
    ).toBe(false);
  });

  it("provides visible title and preview text for history rows", () => {
    const session = {
      id: "real",
      createdAt: 1,
      updatedAt: 1,
      locale: "zh" as const,
      videoTitle: "",
      resultTitle: "结果",
      resultBody: "",
      chatHistory: [{ role: "user" as const, content: "帮我总结这个视频" }]
    };

    expect(buildHistorySessionTitle(session, "zh")).toBe("未命名会话");
    expect(buildHistorySessionPreview(session, "zh")).toBe("帮我总结这个视频");
  });

  it("splits timeline summaries even when timestamps use brackets or list markers", () => {
    const parsed = parseTimelineSummary(
      [
        "整体概览",
        "这节课讲函数。",
        "时间轴分析",
        "- [00:00-01:10] 先讲定义。",
        "**01:10 - 02:30** 再讲例题。",
        "02:30-03:00：最后总结。"
      ].join("\n")
    );

    expect(parsed.segments).toEqual([
      { range: "00:00-01:10", content: "先讲定义。" },
      { range: "01:10 - 02:30", content: "再讲例题。" },
      { range: "02:30-03:00", content: "最后总结。" }
    ]);
  });

  it("builds single-frame capture times from visual cue keywords and merges a 10-second window", () => {
    const plan = buildVisualCueFramePlan(
      [
        "[00:00 - 00:05] 我们先看定义。",
        "[00:10 - 00:12] 接下来的图片非常重要。",
        "[00:13 - 00:14] 请大家看一下这个场景。",
        "[00:20 - 00:22] 请大家看一下这个场景。",
        "[00:30 - 00:33] 这里继续讲公式。"
      ].join("\n"),
      40
    );

    expect(plan.cues.map((cue) => cue.endTime)).toEqual([14, 22]);
    expect(plan.frameTimes).toEqual([15.2, 23.2]);
  });

  it("keeps step cues separate even when they are close together", () => {
    const plan = buildVisualCueFramePlan(
      [
        "[00:30 - 00:31] 第一步，打开设置页面。",
        "[00:32 - 00:33] 第二步，点击运行按钮。"
      ].join("\n"),
      60
    );

    expect(plan.cues.map((cue) => cue.endTime)).toEqual([31, 33]);
    expect(plan.frameTimes).toEqual([32.2, 34.2]);
  });

  it("marks dense keyword windows and uses uniform capture events", () => {
    const plan = buildVisualCueFramePlan(
      Array.from({ length: 11 }, (_, index) => {
        const start = index * 2;
        const end = start + 1;
        return `[00:${String(start).padStart(2, "0")} - 00:${String(end).padStart(2, "0")}] 请看这个图表。`;
      }).join("\n"),
      60
    );

    expect(plan.denseWarnings).toEqual([
      {
        startTime: 0,
        endTime: 21,
        count: 11
      }
    ]);
    expect(plan.cues.map((cue) => cue.reason)).toContain("dense-window");
    expect(plan.frameTimes.length).toBeLessThanOrEqual(3);
  });

  it("keeps only AI-approved high-confidence cues and caps frames per minute", () => {
    const transcript = Array.from({ length: 5 }, (_, index) => {
      const start = index * 8;
      const end = start + 1;
      return `[00:${String(start).padStart(2, "0")} - 00:${String(end).padStart(2, "0")}] 请看这个结果。`;
    }).join("\n");
    const localCandidates = buildVisualCueCandidates(transcript);
    const plan = buildVisualCueFramePlan(
      transcript,
      60,
      localCandidates.map((candidate, index) => ({
        id: candidate.id,
        keyword: "请看",
        score: index === 1 ? 0.7 : 0.86
      }))
    );

    expect(plan.cues).toHaveLength(3);
    expect(plan.cues.every((cue) => (cue.confidence ?? 0) >= 0.75)).toBe(true);
    expect(plan.frameTimes).toEqual([2.2, 18.2, 26.2]);
  });

  it("builds a compact visual cue judgement prompt from local candidates only", () => {
    const transcript = [
      "[00:00 - 00:05] 这里先讲一个不相关的背景。",
      "[00:05 - 00:07] 请看这个图表。",
      "[00:07 - 00:10] 图中显示了增长趋势。"
    ].join("\n");
    const candidates = buildVisualCueCandidates(transcript);
    const prompt = buildVisualCueJudgementPrompt(candidates, "zh");

    expect(candidates).toHaveLength(2);
    expect(prompt).toContain("只返回 JSON");
    expect(prompt).toContain(candidates[0].id);
    expect(prompt).toContain("请看这个图表");
    expect(prompt).not.toContain("完整转写");
  });

  it("parses minimal visual cue judgement JSON from model replies", () => {
    expect(
      parseVisualCueJudgementResponse(
        '```json\n[{"id":"cue-1","time":12.3,"keyword":"看这里","score":0.9}]\n```'
      )
    ).toEqual([{ id: "cue-1", time: 12.3, keyword: "看这里", score: 0.9 }]);
  });

  it("does not request visual frames when no visual cue keyword appears", () => {
    const plan = buildVisualCueFramePlan(
      "[00:00 - 00:05] 我们先看定义。\n[00:05 - 00:10] 然后讲性质。",
      20
    );

    expect(plan.cues).toEqual([]);
    expect(plan.frameTimes).toEqual([]);
  });

  it("describes visual cue frames as OCR supplements for mind maps", () => {
    const instruction = buildMindMapVisualCueInstruction(
      [
        {
          text: "请看这个图表。",
          startTime: 10,
          endTime: 12,
          category: "chart",
          confidence: 0.92,
          captureTime: 13.2,
          sampleTimes: [13.2]
        }
      ],
      [{ time: 13.2, imageBase64: "data:image/jpeg;base64,a" }],
      [],
      "zh"
    );

    expect(instruction).toContain("思维导图");
    expect(instruction).toContain("OCR");
    expect(instruction).toContain("00:13");
  });

  it("describes visual cue frames for detailed summary prompts", () => {
    const instruction = buildDetailedSummaryVisualCueInstruction(
      [
        {
          text: "请看这个图表。",
          startTime: 10,
          endTime: 12,
          category: "chart",
          confidence: 0.92,
          captureTime: 13.5,
          sampleTimes: [12.6, 12.9, 13.2, 13.5, 13.8, 14.1, 14.4]
        }
      ],
      [
        { time: 12.6, imageBase64: "data:image/jpeg;base64,a" },
        { time: 13.5, imageBase64: "data:image/jpeg;base64,b" }
      ],
      [{ startTime: 0, endTime: 21, count: 11 }],
      "zh"
    );

    expect(instruction).toContain("视觉提示关键词");
    expect(instruction).toContain("00:12");
    expect(instruction).toContain("00:13");
    expect(instruction).toContain("关键词密集");
  });
});
