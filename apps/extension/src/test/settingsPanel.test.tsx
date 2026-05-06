import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../sidebar/components/SettingsPanel";

afterEach(() => {
  cleanup();
});

describe("SettingsPanel", () => {
  it("shows labels and applies provider configuration on button click", () => {
    const onProviderConfigChange = vi.fn();

    render(
      <SettingsPanel
        providerConfig={{
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
        apiKey: "",
        model: "deepseek-v4-flash",
        transcriptionModel: "whisper-1",
        visionEnabled: false
      }}
        onProviderConfigChange={onProviderConfigChange}
        locale="en"
      />
    );

    expect(screen.getByText("API Settings")).toBeTruthy();
    expect(screen.getByText("Provider")).toBeTruthy();
    expect(screen.getByText("Transcription Model")).toBeTruthy();
    expect(screen.getByText("Backend URL")).toBeTruthy();
    expect(screen.getByText("Speech Provider")).toBeTruthy();
    expect(screen.queryByText("Tencent Cloud ASR")).toBeNull();
    expect(screen.queryByText("OpenAI Compatible Upload")).toBeNull();
    expect(screen.getByText("DashScope + OSS")).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue("https://api.deepseek.com"), {
      target: { value: "https://example.com/v1" }
    });
    fireEvent.change(screen.getByLabelText("Backend URL"), {
      target: { value: "https://backend.example" }
    });
    fireEvent.click(screen.getByText("Apply"));

    expect(onProviderConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://example.com/v1",
        transcriptionBackendUrl: "https://backend.example"
      })
    );
    expect(screen.getByText("Applied")).toBeTruthy();
  });

  it("switches to qwen presets when provider changes", () => {
    const onProviderConfigChange = vi.fn();

    render(
      <SettingsPanel
        providerConfig={{
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
        apiKey: "",
        model: "deepseek-v4-flash",
        transcriptionModel: "whisper-1",
        visionEnabled: false
      }}
        onProviderConfigChange={onProviderConfigChange}
        locale="en"
      />
    );

    const providerSelect = screen.getByLabelText("Provider");
    fireEvent.change(providerSelect, {
      target: { value: "qwen" }
    });
    fireEvent.click(screen.getByText("Apply"));

    expect(onProviderConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen-plus",
        asrProvider: "dashscope-oss"
      })
    );
  });

  it("normalizes deepseek model casing on apply", () => {
    const onProviderConfigChange = vi.fn();

    render(
      <SettingsPanel
        providerConfig={{
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
        apiKey: "",
        model: "deepseek-v4-flash",
        transcriptionModel: "whisper-1",
        visionEnabled: false
      }}
        onProviderConfigChange={onProviderConfigChange}
        locale="en"
      />
    );

    fireEvent.change(screen.getByDisplayValue("deepseek-v4-flash"), {
      target: { value: "deepseek-V4-flash" }
    });
    fireEvent.click(screen.getByText("Apply"));

    expect(onProviderConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "deepseek-v4-flash"
      })
    );
  });

  it("toggles the vision switch card cleanly", () => {
    const onProviderConfigChange = vi.fn();

    render(
      <SettingsPanel
        providerConfig={{
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
        apiKey: "",
        model: "deepseek-v4-flash",
        transcriptionModel: "whisper-1",
        visionEnabled: false
      }}
        onProviderConfigChange={onProviderConfigChange}
        locale="en"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Enable vision", pressed: false }));
    fireEvent.click(screen.getByText("Apply"));

    expect(onProviderConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        visionEnabled: true
      })
    );
  });

  it("keeps only DashScope OSS speech settings visible and applied", () => {
    const onProviderConfigChange = vi.fn();

    render(
      <SettingsPanel
        providerConfig={{
        provider: "qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "qwen-key",
        model: "qwen-plus",
        transcriptionModel: "paraformer-v2",
        asrProvider: "auto",
        visionEnabled: false
      }}
        onProviderConfigChange={onProviderConfigChange}
        locale="en"
      />
    );

    const speechProvider = screen.getByLabelText("Speech Provider") as HTMLSelectElement;
    expect(Array.from(speechProvider.options).map((option) => option.value)).toEqual([
      "dashscope-oss"
    ]);
    expect(screen.queryByLabelText("Tencent SecretId")).toBeNull();
    expect(screen.getByLabelText("OSS AccessKeyId")).toBeTruthy();

    fireEvent.click(screen.getByText("Apply"));

    expect(onProviderConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "qwen",
        asrProvider: "dashscope-oss"
      })
    );
  });
});
