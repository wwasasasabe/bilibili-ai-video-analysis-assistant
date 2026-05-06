import { describe, expect, it } from "vitest";
import {
  MAX_SUPPORTED_VIDEO_DURATION_SECONDS,
  compactTranscriptForPrompt,
  isSupportedVideoDuration
} from "./videoLimits";

function timestamp(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

describe("video duration support", () => {
  it("allows videos up to 3 hours and rejects longer videos", () => {
    expect(MAX_SUPPORTED_VIDEO_DURATION_SECONDS).toBe(10_800);
    expect(isSupportedVideoDuration(10_800)).toBe(true);
    expect(isSupportedVideoDuration(10_801)).toBe(false);
    expect(isSupportedVideoDuration(undefined)).toBe(true);
  });
});

describe("compactTranscriptForPrompt", () => {
  it("keeps chronological coverage for long 3-hour timestamped transcripts", () => {
    const transcript = Array.from({ length: 37 }, (_, index) => {
      const start = index * 300;
      const end = Math.min(start + 299, MAX_SUPPORTED_VIDEO_DURATION_SECONDS);
      return `[${timestamp(start)} - ${timestamp(end)}] topic-${index} ${"detail ".repeat(120)}`;
    }).join("\n");

    const compacted = compactTranscriptForPrompt(transcript, "en", 6_000);

    expect(compacted.length).toBeLessThanOrEqual(6_200);
    expect(compacted).toContain("stable 3-hour video support");
    expect(compacted).toContain("topic-0");
    expect(compacted).toContain("topic-18");
    expect(compacted).toContain("topic-36");
  });
});
