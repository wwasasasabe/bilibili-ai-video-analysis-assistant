import { describe, expect, it } from "vitest";
import { MAX_SUPPORTED_VIDEO_DURATION_SECONDS } from "@app/shared";
import {
  buildMindmapPrompt,
  buildQuickSummaryPrompt,
  buildSummaryPrompt
} from "../services/promptBuilder";

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

describe("buildSummaryPrompt", () => {
  it("includes active summary skills", () => {
    const prompt = buildSummaryPrompt(
      {
        title: "Prompt Engineering 101",
        description: "Learn prompts",
        uploader: "Creator",
        currentTime: 0,
        duration: 420,
        videoId: "BV1",
        subtitleText: "Step one. Step two."
      },
      [
        {
          id: "learning-focus",
          name: "Learning Focus",
          version: "1.0.0",
          targets: ["summary"],
          prompt: "Prioritize learning outcomes.",
          enabled: true
        }
      ]
    );

    expect(prompt).toContain("Prioritize learning outcomes.");
    expect(prompt).toContain("07:00");
    expect(prompt).toContain("具体内容");
  });
});

describe("buildSummaryPrompt precision", () => {
  it("asks for exact concepts and evidence-based segmenting in chinese", () => {
    const prompt = buildSummaryPrompt(
      {
        title: "n阶行列式",
        description: "",
        uploader: "Author",
        currentTime: 0,
        duration: 1723,
        videoId: "BV1",
        subtitleText: "先讲定义，再讲性质，再讲展开。",
        noteText: "重点关注定义、性质和展开。"
      },
      [],
      "zh"
    );

    expect(prompt).toContain("具体概念");
    expect(prompt).toContain("公式");
    expect(prompt).toContain("字幕、转录和笔记");
  });

  it("uses timestamped transcripts as the source of timeline boundaries", () => {
    const prompt = buildSummaryPrompt(
      {
        title: "Determinants",
        description: "",
        uploader: "Author",
        currentTime: 0,
        duration: 120,
        videoId: "BV1",
        subtitleText: "current subtitle only",
        transcriptText: "[00:00 - 00:10] definition\n[00:10 - 00:30] determinant example"
      },
      [],
      "en"
    );

    expect(prompt).toContain("[00:00 - 00:10] definition");
    expect(prompt).not.toContain("Subtitle or transcript: current subtitle only");
    expect(prompt).toContain("Use those timestamps as the only evidence");
  });

  it("compacts long 3-hour transcripts while preserving chronological coverage", () => {
    const prompt = buildSummaryPrompt(
      {
        title: "3-hour lesson",
        description: "",
        uploader: "Teacher",
        currentTime: 0,
        duration: MAX_SUPPORTED_VIDEO_DURATION_SECONDS,
        videoId: "BV-long",
        subtitleText: "current subtitle only",
        transcriptText: buildLongTimestampedTranscript()
      },
      [],
      "en"
    );

    expect(prompt).toContain("Actual video duration: 03:00:00");
    expect(prompt).toContain("stable 3-hour video support");
    expect(prompt).toContain("topic-0");
    expect(prompt).toContain("topic-18");
    expect(prompt).toContain("topic-36");
    expect(prompt.length).toBeLessThan(150_000);
  });
});

describe("buildQuickSummaryPrompt", () => {
  it("builds a compact summary prompt without timeline requirements", () => {
    const prompt = buildQuickSummaryPrompt(
      {
        title: "Mapping basics",
        description: "",
        uploader: "Teacher",
        currentTime: 0,
        duration: 420,
        videoId: "BV1",
        subtitleText: "Definitions, examples, and final notes."
      },
      [],
      "en"
    );

    expect(prompt).toContain("Quick Summary");
    expect(prompt).toContain("Do not create a timeline");
    expect(prompt).not.toContain("Timeline Analysis");
    expect(prompt).not.toContain("00:00 - 01:12");
  });
});

describe("buildMindmapPrompt", () => {
  it("asks the model to choose one mind map layout and return structured json", () => {
    const prompt = buildMindmapPrompt(
      {
        title: "Prompt Engineering 101",
        description: "Learn prompts",
        uploader: "Creator",
        currentTime: 0,
        duration: 420,
        videoId: "BV1",
        pageNumber: 4,
        episodeTitle: "结构化提示词",
        subtitleText: "先讲流程，再讲对比，再讲结构。"
      },
      [],
      "zh"
    );

    expect(prompt).toContain("tree");
    expect(prompt).toContain("timeline");
    expect(prompt).toContain("cluster");
    expect(prompt).toContain("comparison");
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("当前选集");
    expect(prompt).toContain("每个节点文案都要短、准、自然");
  });

  it("warns against defaulting to tree for parallel sections", () => {
    const prompt = buildMindmapPrompt(
      {
        title: "Linear Algebra Chapter 1",
        description: "",
        uploader: "Creator",
        currentTime: 0,
        duration: 420,
        videoId: "BV1",
        pageNumber: 4,
        episodeTitle: "Determinants",
        subtitleText: "Definition. Properties. Methods. Special cases."
      },
      [],
      "en"
    );

    expect(prompt).toContain("Do not use tree as the default layout.");
    expect(prompt).toContain("Prefer cluster when the content is organized as several parallel sections");
  });

  it("asks for broad vocabulary coverage in word lessons", () => {
    const prompt = buildMindmapPrompt(
      {
        title: "CET-6 vocabulary lesson",
        description: "A lesson with many important English words.",
        uploader: "Teacher",
        currentTime: 72,
        duration: 390,
        videoId: "BV1",
        subtitleText: "alleviate v. reduce pain or stress",
        transcriptText:
          "[00:00 - 01:20] alleviate means to make pain or stress less severe.\n" +
          "[01:20 - 02:40] ambiguous means unclear or having more than one meaning.\n" +
          "[02:40 - 04:00] anticipate means to expect something before it happens.\n" +
          "[04:00 - 05:10] apprehend means to understand or arrest.\n" +
          "[05:10 - 06:30] explicit means clear, direct, and not hidden."
      },
      [],
      "en"
    );

    expect(prompt).toContain("[04:00 - 05:10] apprehend");
    expect(prompt).not.toContain("Subtitle or transcript: alleviate v. reduce pain or stress");
    expect(prompt).toContain("vocabulary");
    expect(prompt).toContain("English headwords");
    expect(prompt).toContain("Do not keep only a few sample words");
  });

  it("uses audio first, subtitles second, and OCR only as a final supplement for mind maps", () => {
    const prompt = buildMindmapPrompt(
      {
        title: "CET-6 vocabulary lesson",
        description: "",
        uploader: "Teacher",
        currentTime: 260,
        duration: 2591,
        videoId: "BV1",
        subtitleText: "short subtitle",
        transcriptText: "[00:00 - 00:30] full speech transcript"
      },
      [],
      "en"
    );

    expect(prompt).toContain("Speech transcript is the primary source");
    expect(prompt).toContain("subtitles are only supporting evidence");
    expect(prompt).toContain("OCR is a final supplement");
    expect(prompt).toContain("only when the model can identify readable learning content");
    expect(prompt).toContain("do not replace or contradict the speech transcript");
  });
});
