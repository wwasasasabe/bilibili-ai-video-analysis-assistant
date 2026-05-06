import type { ProviderConfig } from "@app/shared";

export const PROVIDER_STORAGE_KEY = "provider-config";
export const SKILLS_STORAGE_KEY = "installed-skills";
export const LOCALE_STORAGE_KEY = "ui-locale";
export const RESPONSE_PREFERENCE_STORAGE_KEY = "response-preference";
export const CUSTOM_PROMPT_STORAGE_KEY = "custom-prompt";
export const HISTORY_SESSIONS_STORAGE_KEY = "history-sessions";
export const ONLY_ASR_PROVIDER: ProviderConfig["asrProvider"] = "dashscope-oss";

export const PROVIDER_PRESETS: Record<
  ProviderConfig["provider"],
  Pick<
    ProviderConfig,
    | "baseUrl"
    | "model"
    | "visionEnabled"
    | "transcriptionModel"
    | "asrProvider"
    | "transcriptionBackendUrl"
    | "tencentEngineModelType"
    | "ossRegion"
    >
> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    transcriptionModel: "paraformer-v2",
    asrProvider: ONLY_ASR_PROVIDER,
    tencentEngineModelType: "16k_zh_large",
    ossRegion: "oss-cn-hangzhou",
    visionEnabled: false
  },
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    transcriptionModel: "paraformer-v2",
    asrProvider: ONLY_ASR_PROVIDER,
    tencentEngineModelType: "16k_zh_large",
    ossRegion: "oss-cn-hangzhou",
    visionEnabled: false
  },
  glm: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.5",
    transcriptionModel: "paraformer-v2",
    asrProvider: ONLY_ASR_PROVIDER,
    tencentEngineModelType: "16k_zh_large",
    ossRegion: "oss-cn-hangzhou",
    visionEnabled: false
  },
  minimax: {
    baseUrl: "https://api.minimaxi.com/v1",
    model: "MiniMax-M2.7",
    transcriptionModel: "paraformer-v2",
    asrProvider: ONLY_ASR_PROVIDER,
    tencentEngineModelType: "16k_zh_large",
    ossRegion: "oss-cn-hangzhou",
    visionEnabled: false
  },
  mimo: {
    baseUrl: "https://api.mimo-v2.com/v1",
    model: "MiMo-V2-Pro",
    transcriptionModel: "paraformer-v2",
    asrProvider: ONLY_ASR_PROVIDER,
    tencentEngineModelType: "16k_zh_large",
    ossRegion: "oss-cn-hangzhou",
    visionEnabled: true
  },
  kimi: {
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k2.5",
    transcriptionModel: "paraformer-v2",
    asrProvider: ONLY_ASR_PROVIDER,
    tencentEngineModelType: "16k_zh_large",
    ossRegion: "oss-cn-hangzhou",
    visionEnabled: true
  },
  custom: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    transcriptionModel: "paraformer-v2",
    asrProvider: ONLY_ASR_PROVIDER,
    tencentEngineModelType: "16k_zh_large",
    ossRegion: "oss-cn-hangzhou",
    visionEnabled: true
  }
};

export function normalizeProviderConfig(
  input: Omit<ProviderConfig, "visionEnabled"> & { visionEnabled?: boolean }
): ProviderConfig {
  return {
    ...input,
    transcriptionModel: input.transcriptionModel?.trim() || "paraformer-v2",
    transcriptionBackendUrl: input.transcriptionBackendUrl?.trim() || undefined,
    asrProvider: ONLY_ASR_PROVIDER,
    tencentSecretId: input.tencentSecretId?.trim(),
    tencentSecretKey: input.tencentSecretKey?.trim(),
    tencentEngineModelType: input.tencentEngineModelType?.trim() || "16k_zh_large",
    ossAccessKeyId: input.ossAccessKeyId?.trim(),
    ossAccessKeySecret: input.ossAccessKeySecret?.trim(),
    ossRegion: input.ossRegion?.trim() || "oss-cn-hangzhou",
    ossBucket: input.ossBucket?.trim(),
    ossEndpoint: input.ossEndpoint?.trim(),
    visionEnabled: input.visionEnabled ?? false
  };
}

export function getDefaultProviderConfig(): ProviderConfig {
  return {
    provider: "deepseek",
    baseUrl: PROVIDER_PRESETS.deepseek.baseUrl,
    apiKey: "",
    model: PROVIDER_PRESETS.deepseek.model,
    transcriptionModel: PROVIDER_PRESETS.deepseek.transcriptionModel,
    asrProvider: PROVIDER_PRESETS.deepseek.asrProvider,
    tencentEngineModelType: PROVIDER_PRESETS.deepseek.tencentEngineModelType,
    ossRegion: PROVIDER_PRESETS.deepseek.ossRegion,
    visionEnabled: PROVIDER_PRESETS.deepseek.visionEnabled
  };
}
