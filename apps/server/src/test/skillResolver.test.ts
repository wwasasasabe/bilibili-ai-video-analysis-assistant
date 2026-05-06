import { describe, expect, it } from "vitest";
import { resolveSkills } from "../services/skillResolver";

describe("resolveSkills", () => {
  it("returns enabled skills matching the requested target", () => {
    const skills = resolveSkills("summary", [
      {
        id: "summary-skill",
        name: "Summary",
        version: "1.0.0",
        prompt: "Summarize for learning.",
        targets: ["summary"],
        enabled: true
      },
      {
        id: "qa-skill",
        name: "QA",
        version: "1.0.0",
        prompt: "Answer briefly.",
        targets: ["qa"],
        enabled: true
      }
    ]);

    expect(skills).toHaveLength(1);
    expect(skills[0]?.id).toBe("summary-skill");
  });
});
