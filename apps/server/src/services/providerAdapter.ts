import type { ProviderConfig } from "@app/shared";

export function buildProviderHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

export function buildChatCompletionsUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface ChatMessageContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
  };
}

function formatProviderError(status: number, endpoint: string, responseText: string) {
  const detail = responseText.trim();

  if (!detail) {
    return `Provider request failed with status ${status}. Endpoint: ${endpoint}`;
  }

  return `Provider request failed with status ${status}. Endpoint: ${endpoint}. Detail: ${detail}`;
}

export function buildProviderMessageContent(prompt: string, imageBase64List: string[] = []) {
  const images = imageBase64List.filter((image) => image.trim().length > 0);

  if (images.length === 0) {
    return prompt;
  }

  const content: ChatMessageContentPart[] = [{ type: "text", text: prompt }];

  for (const imageUrl of images) {
    content.push({
      type: "image_url",
      image_url: {
        url: imageUrl
      }
    });
  }

  return content;
}

export async function callChatCompletion(
  providerConfig: ProviderConfig,
  prompt: string,
  imageBase64List: string[] = []
) {
  const endpoint = buildChatCompletionsUrl(providerConfig.baseUrl);
  const content = providerConfig.visionEnabled
    ? buildProviderMessageContent(prompt, imageBase64List)
    : prompt;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildProviderHeaders(providerConfig.apiKey),
    body: JSON.stringify({
      model: providerConfig.model,
      messages: [{ role: "user", content }]
    })
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(formatProviderError(response.status, endpoint, responseText));
  }

  const json = (await response.json()) as ChatCompletionResponse;
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}
