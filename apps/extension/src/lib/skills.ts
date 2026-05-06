import { customSkillSchema, type CustomSkill } from "@app/shared";

export function installSkill(input: unknown): CustomSkill {
  return customSkillSchema.parse(input);
}

export function toggleSkill(skill: CustomSkill, enabled: boolean): CustomSkill {
  return { ...skill, enabled };
}
