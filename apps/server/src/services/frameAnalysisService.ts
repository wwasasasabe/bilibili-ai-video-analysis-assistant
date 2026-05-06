import type { AppLocale } from "@app/shared";

export async function analyzeFrame(_frameImageBase64: string, locale: AppLocale = "zh") {
  return {
    title: locale === "en" ? "Frame analysis" : "图片分析",
    body:
      locale === "en"
        ? "Detected a paused video frame with slide, interface, or code-like content."
        : "检测到一张暂停视频画面，内容看起来像幻灯片、界面或代码相关内容。"
  };
}
