import { describe, expect, it } from "vitest";
import { buildAnalyzePayload } from "../lib/api";

describe("buildAnalyzePayload", () => {
  it("includes active skills", () => {
    const payload = buildAnalyzePayload(
      {
        videoId: "BV1",
        title: "Video",
        description: "",
        uploader: "Author",
        currentTime: 5
      },
      [
        {
          id: "qa-style",
          name: "QA Style",
          version: "1.0.0",
          prompt: "Answer briefly and cite timestamps.",
          targets: ["qa"],
          enabled: true
        }
      ],
      "summary"
    );

    expect(payload.activeSkills).toHaveLength(1);
  });
});
