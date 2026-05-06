import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CustomSkill } from "@app/shared";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installSkill, toggleSkill } from "../lib/skills";
import { SkillManager } from "../sidebar/components/SkillManager";

afterEach(() => {
  cleanup();
});

function SkillManagerHarness() {
  const [skills, setSkills] = useState<CustomSkill[]>([]);

  return (
    <SkillManager
      skills={skills}
      onInstallSkill={(rawSkill) => {
        const parsed = installSkill(JSON.parse(rawSkill) as unknown);
        setSkills((currentSkills) => {
          const filtered = currentSkills.filter((skill) => skill.id !== parsed.id);
          return [...filtered, parsed];
        });
      }}
      onToggleSkill={(skillId, enabled) => {
        setSkills((currentSkills) =>
          currentSkills.map((skill) =>
            skill.id === skillId ? toggleSkill(skill, enabled) : skill
          )
        );
      }}
      locale="en"
    />
  );
}

describe("SkillManager", () => {
  it("loads uploaded skill file content into the editor and adds the skill to the library", async () => {
    render(<SkillManagerHarness />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(
      [
        JSON.stringify({
          id: "video-qa",
          name: "Video QA",
          version: "1.0.0",
          prompt: "Answer with video context.",
          targets: ["qa"],
          enabled: true
        })
      ],
      "video-qa.skill",
      { type: "application/json" }
    );

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByDisplayValue(/"video-qa"/)).toBeTruthy();
      expect(screen.getByText("video-qa.skill")).toBeTruthy();
      expect(screen.getByText("Video QA")).toBeTruthy();
    });
  });

  it("expands the skill directory and toggles the enabled state", () => {
    const onToggleSkill = vi.fn();

    render(
      <SkillManager
        skills={[
          {
            id: "video-qa",
            name: "Video QA",
            version: "1.0.0",
            prompt: "Answer with the current video context and keep it practical.",
            targets: ["qa"],
            enabled: true
          }
        ]}
        onInstallSkill={vi.fn()}
        onToggleSkill={onToggleSkill}
        locale="en"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle Skill Directory" }));
    expect(screen.getByText("Video QA")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Video QA On" }));

    expect(onToggleSkill).toHaveBeenCalledWith("video-qa", false);
  });
});
