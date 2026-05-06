import { describe, expect, it } from "vitest";
import { installSkill } from "../lib/skills";

describe("installSkill", () => {
  it("rejects a skill without targets", () => {
    expect(() =>
      installSkill({
        id: "bad",
        name: "Bad",
        version: "1.0.0",
        prompt: "short"
      })
    ).toThrow();
  });
});
