import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "B站AI视频分析助手",
  version: "0.1.0",
  description: "在 Bilibili 视频页提供快速摘要、细节摘要、图片分析、对话和思维导图。",
  permissions: ["storage", "sidePanel", "tabs", "activeTab", "scripting", "webRequest"],
  host_permissions: [
    "https://www.bilibili.com/*",
    "https://*.bilibili.com/*",
    "https://*.hdslb.com/*",
    "https://*.bilivideo.com/*",
    "https://*.bilivideo.cn/*",
    "https://*.akamaized.net/*",
    "http://127.0.0.1:3001/*",
    "https://api.deepseek.com/*",
    "https://dashscope.aliyuncs.com/*",
    "https://*.aliyuncs.com/*",
    "https://open.bigmodel.cn/*",
    "https://api.minimaxi.com/*",
    "https://api.mimo-v2.com/*",
    "https://api.moonshot.cn/*",
    "https://api.openai.com/*"
  ],
  background: {
    service_worker: "src/background/index.ts",
    type: "module"
  },
  content_scripts: [
    {
      matches: ["https://www.bilibili.com/video/*"],
      js: ["src/content/index.ts"]
    }
  ],
  side_panel: {
    default_path: "src/sidebar/index.html"
  },
  action: {
    default_title: "B站AI视频分析助手"
  }
});
