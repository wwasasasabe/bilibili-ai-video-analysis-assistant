import type {
  AppLocale,
  AnalyzeRequest,
  CustomSkill,
  PageContext,
  ProviderConfig
} from "@app/shared";

export function buildAnalyzePayload(
  context: PageContext,
  activeSkills: CustomSkill[],
  mode: AnalyzeRequest["mode"],
  locale?: AppLocale,
  question?: string,
  frameImageBase64?: string,
  frameImageBase64List?: string[],
  providerConfig?: ProviderConfig
): AnalyzeRequest {
  return {
    mode,
    context,
    locale,
    activeSkills,
    question,
    frameImageBase64,
    frameImageBase64List,
    providerConfig
  };
}
