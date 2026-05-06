import type { ProviderConfig } from "@app/shared";
import { useEffect, useState } from "react";
import { ONLY_ASR_PROVIDER, PROVIDER_PRESETS } from "../../lib/storage";

type Locale = "zh" | "en";

interface SettingsPanelProps {
  providerConfig: ProviderConfig;
  onProviderConfigChange: (config: ProviderConfig) => void;
  locale?: Locale;
}

const copy = {
  zh: {
    title: "API 配置",
    description: "配置模型供应商、API Key、模型名称和语音转写方式。",
    provider: "供应商",
    model: "模型",
    transcriptionModel: "转写模型",
    transcriptionBackendUrl: "后端 URL",
    speechProvider: "语音转写供应商",
    speechProviderHint:
      "DashScope + OSS 需要你填写自己的后端 URL。后端会用用户自己的 OSS Key 临时上传音频，再提交给 DashScope 识别。",
    backendHint:
      "填写你自己部署的后端地址，例如 https://api.example.com。后端必须启用 CORS，并提供 /api/transcribe/dashscope-oss。",
    tencentSecretId: "腾讯云 SecretId",
    tencentSecretKey: "腾讯云 SecretKey",
    tencentEngine: "腾讯云 ASR 引擎",
    ossAccessKeyId: "OSS AccessKeyId",
    ossAccessKeySecret: "OSS AccessKeySecret",
    ossRegion: "OSS Region",
    ossBucket: "OSS Bucket",
    ossEndpoint: "OSS Endpoint（可选）",
    transcriptionHint: "DashScope + OSS 推荐使用 paraformer-v2。",
    vision: "启用视觉能力",
    visionHint: "让图片分析和多模态模型请求一起生效。",
    hint:
      "已预置 DeepSeek、Qwen、GLM、MiniMax、MiMo、Kimi 的推荐地址；如果账号有区域专用地址，也可以手动修改 Base URL。",
    apply: "应用",
    applied: "已应用"
  },
  en: {
    title: "API Settings",
    description: "Configure provider, API key, chat model, and speech transcription.",
    provider: "Provider",
    model: "Model",
    transcriptionModel: "Transcription Model",
    transcriptionBackendUrl: "Backend URL",
    speechProvider: "Speech Provider",
    speechProviderHint:
      "DashScope + OSS requires your own backend URL. The backend uses the user's OSS keys for temporary storage, then submits the signed URL to DashScope.",
    backendHint:
      "Enter your self-hosted backend, for example https://api.example.com. It must enable CORS and expose /api/transcribe/dashscope-oss.",
    tencentSecretId: "Tencent SecretId",
    tencentSecretKey: "Tencent SecretKey",
    tencentEngine: "Tencent ASR Engine",
    ossAccessKeyId: "OSS AccessKeyId",
    ossAccessKeySecret: "OSS AccessKeySecret",
    ossRegion: "OSS Region",
    ossBucket: "OSS Bucket",
    ossEndpoint: "OSS Endpoint (optional)",
    transcriptionHint: "DashScope + OSS recommends paraformer-v2.",
    vision: "Enable vision",
    visionHint: "Allow image analysis and multimodal model requests.",
    hint:
      "Preset endpoints are included for DeepSeek, Qwen, GLM, MiniMax, MiMo, and Kimi. You can still edit the Base URL manually if your account uses a regional endpoint.",
    apply: "Apply",
    applied: "Applied"
  }
} as const;

function normalizeDraftConfig(config: ProviderConfig): ProviderConfig {
  const transcriptionModel = config.transcriptionModel?.trim() || "paraformer-v2";
  const tencentEngineModelType =
    config.tencentEngineModelType?.trim() || "16k_zh_large";
  const ossRegion = config.ossRegion?.trim() || "oss-cn-hangzhou";

  return {
    ...config,
    model:
      config.provider === "deepseek"
        ? config.model.trim().toLowerCase()
        : config.model.trim(),
    transcriptionModel,
    transcriptionBackendUrl: config.transcriptionBackendUrl?.trim() || undefined,
    asrProvider: ONLY_ASR_PROVIDER,
    tencentEngineModelType,
    tencentSecretId: config.tencentSecretId?.trim(),
    tencentSecretKey: config.tencentSecretKey?.trim(),
    ossAccessKeyId: config.ossAccessKeyId?.trim(),
    ossAccessKeySecret: config.ossAccessKeySecret?.trim(),
    ossRegion,
    ossBucket: config.ossBucket?.trim(),
    ossEndpoint: config.ossEndpoint?.trim()
  };
}

export function SettingsPanel({
  providerConfig,
  onProviderConfigChange,
  locale = "zh"
}: SettingsPanelProps) {
  const [draftConfig, setDraftConfig] = useState(providerConfig);
  const [applied, setApplied] = useState(false);
  const text = copy[locale];

  useEffect(() => {
    setDraftConfig(providerConfig);
  }, [providerConfig]);

  function updateField<K extends keyof ProviderConfig>(key: K, value: ProviderConfig[K]) {
    setApplied(false);
    setDraftConfig((current) => ({
      ...current,
      [key]: value
    }));
  }

  function handleProviderChange(provider: ProviderConfig["provider"]) {
    const preset = PROVIDER_PRESETS[provider];
    setApplied(false);
    setDraftConfig((current) => ({
      ...current,
      provider,
      baseUrl: preset.baseUrl,
      model: preset.model,
      transcriptionModel: preset.transcriptionModel,
      transcriptionBackendUrl: current.transcriptionBackendUrl,
      asrProvider: ONLY_ASR_PROVIDER,
      tencentSecretId: current.tencentSecretId,
      tencentSecretKey: current.tencentSecretKey,
      tencentEngineModelType:
        current.tencentEngineModelType ?? preset.tencentEngineModelType,
      ossAccessKeyId: current.ossAccessKeyId,
      ossAccessKeySecret: current.ossAccessKeySecret,
      ossRegion: current.ossRegion ?? preset.ossRegion,
      ossBucket: current.ossBucket,
      ossEndpoint: current.ossEndpoint,
      visionEnabled: preset.visionEnabled
    }));
  }

  function applyConfig() {
    const normalizedConfig = normalizeDraftConfig(draftConfig);
    setDraftConfig(normalizedConfig);
    onProviderConfigChange(normalizedConfig);
    setApplied(true);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{text.title}</h2>
        <p>{text.description}</p>
      </div>
      <div className="form-grid settings-stack">
        <label>
          {text.provider}
          <select
            aria-label={text.provider}
            value={draftConfig.provider}
            onChange={(event) =>
              handleProviderChange(event.target.value as ProviderConfig["provider"])
            }
          >
            <option value="deepseek">DeepSeek</option>
            <option value="qwen">Qwen</option>
            <option value="glm">GLM</option>
            <option value="minimax">MiniMax</option>
            <option value="mimo">MiMo</option>
            <option value="kimi">Kimi</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          Base URL
          <input
            value={draftConfig.baseUrl}
            onChange={(event) => updateField("baseUrl", event.target.value)}
          />
        </label>
        <label>
          API Key
          <input
            type="password"
            value={draftConfig.apiKey}
            onChange={(event) => updateField("apiKey", event.target.value)}
          />
        </label>
        <label>
          {text.model}
          <input
            value={draftConfig.model}
            onChange={(event) => updateField("model", event.target.value)}
          />
        </label>
        <label>
          {text.speechProvider}
          <select
            aria-label={text.speechProvider}
            value={ONLY_ASR_PROVIDER}
            onChange={() => updateField("asrProvider", ONLY_ASR_PROVIDER)}
          >
            <option value="dashscope-oss">DashScope + OSS</option>
          </select>
          <span className="field-hint">{text.speechProviderHint}</span>
        </label>

        <label>
          {text.transcriptionBackendUrl}
          <input
            aria-label={text.transcriptionBackendUrl}
            value={draftConfig.transcriptionBackendUrl ?? ""}
            onChange={(event) =>
              updateField("transcriptionBackendUrl", event.target.value)
            }
            placeholder="https://api.example.com"
          />
          <span className="field-hint">{text.backendHint}</span>
        </label>

        <label>
          {text.ossAccessKeyId}
          <input
            aria-label={text.ossAccessKeyId}
            value={draftConfig.ossAccessKeyId ?? ""}
            onChange={(event) => updateField("ossAccessKeyId", event.target.value)}
          />
        </label>
        <label>
          {text.ossAccessKeySecret}
          <input
            aria-label={text.ossAccessKeySecret}
            type="password"
            value={draftConfig.ossAccessKeySecret ?? ""}
            onChange={(event) => updateField("ossAccessKeySecret", event.target.value)}
          />
        </label>
        <label>
          {text.ossRegion}
          <input
            aria-label={text.ossRegion}
            value={draftConfig.ossRegion ?? "oss-cn-hangzhou"}
            onChange={(event) => updateField("ossRegion", event.target.value)}
          />
        </label>
        <label>
          {text.ossBucket}
          <input
            aria-label={text.ossBucket}
            value={draftConfig.ossBucket ?? ""}
            onChange={(event) => updateField("ossBucket", event.target.value)}
          />
        </label>
        <label>
          {text.ossEndpoint}
          <input
            aria-label={text.ossEndpoint}
            value={draftConfig.ossEndpoint ?? ""}
            onChange={(event) => updateField("ossEndpoint", event.target.value)}
            placeholder="oss-cn-hangzhou.aliyuncs.com"
          />
        </label>

        <label>
          {text.transcriptionModel}
          <input
            value={draftConfig.transcriptionModel ?? "paraformer-v2"}
            onChange={(event) => updateField("transcriptionModel", event.target.value)}
          />
          <span className="field-hint">{text.transcriptionHint}</span>
        </label>

        <div className="vision-toggle-card">
          <div className="vision-toggle-copy">
            <strong>{text.vision}</strong>
            <span>{text.visionHint}</span>
          </div>
          <button
            type="button"
            className={
              draftConfig.visionEnabled ? "switch-button active" : "switch-button"
            }
            aria-label={text.vision}
            aria-pressed={draftConfig.visionEnabled}
            onClick={() => updateField("visionEnabled", !draftConfig.visionEnabled)}
          >
            <span className="switch-thumb" />
          </button>
        </div>

        <p className="panel-note settings-hint">{text.hint}</p>
        <div className="action-row skill-upload-row">
          <button type="button" onClick={applyConfig}>
            {text.apply}
          </button>
          {applied ? <span className="status-text">{text.applied}</span> : null}
        </div>
      </div>
    </section>
  );
}
