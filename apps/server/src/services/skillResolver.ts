import type { CustomSkill } from "@app/shared";

export function resolveSkills(
  target: "summary" | "qa" | "frame-analysis",
  skills: CustomSkill[]
) {
  return skills.filter((skill) => skill.enabled && skill.targets.includes(target));
}
