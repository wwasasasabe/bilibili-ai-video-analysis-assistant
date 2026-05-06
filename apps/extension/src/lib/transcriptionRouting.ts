import type { ProviderConfig } from "@app/shared";

export type BilibiliAudioTranscriptionInputMode = "blob" | "base64";

export function getBilibiliAudioTranscriptionInputMode(
  providerConfig: ProviderConfig
): BilibiliAudioTranscriptionInputMode {
  if (providerConfig.asrProvider === "openai") {
    return "base64";
  }

  return "blob";
}
