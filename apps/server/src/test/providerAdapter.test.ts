import { describe, expect, it } from "vitest";
import {
  buildProviderMessageContent,
  buildChatCompletionsUrl,
  buildProviderHeaders
} from "../services/providerAdapter";

describe("provider adapter", () => {
  it("creates a bearer token header", () => {
    expect(buildProviderHeaders("secret")).toEqual({
      Authorization: "Bearer secret",
      "Content-Type": "application/json"
    });
  });

  it("appends the chat endpoint only once", () => {
    expect(buildChatCompletionsUrl("https://api.deepseek.com")).toBe(
      "https://api.deepseek.com/chat/completions"
    );
    expect(buildChatCompletionsUrl("https://dashscope.aliyuncs.com/compatible-mode/v1")).toBe(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    );
    expect(
      buildChatCompletionsUrl("https://api.openai.com/v1/chat/completions")
    ).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("builds multi-image message content for sampled frames", () => {
    expect(
      buildProviderMessageContent("Read frames", [
        "data:image/jpeg;base64,one",
        "data:image/jpeg;base64,two"
      ])
    ).toEqual([
      { type: "text", text: "Read frames" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,one" } },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,two" } }
    ]);
  });
});
