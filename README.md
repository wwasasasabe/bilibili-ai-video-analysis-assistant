# B站AI视频分析助手

面向 Bilibili 视频学习场景的 Edge/Chromium 侧边栏 AI 扩展。它可以在视频页中生成快速摘要、细节摘要、图片分析、继续对话、思维导图，支持视频时长2.5h以内，并支持用户安装自定义 Skill。
（本人本科大一，在b站看看高数时，觉得视频太长了，用codex磋了一个插件，专门用来总结分析长视频，目前只打通了千问大模型+阿里oss，其他的模型不能用，希望有大佬带路，指点，修改里面的bug和改进）
注：需要千问的多模态模型，才能使用全部功能。

## 功能亮点

- 快速摘要：基于页面字幕、笔记和上下文快速概括视频重点。
- 细节摘要：在真实浏览器环境中抓取 B站音频，临时上传到用户配置的 OSS，经 DashScope ASR 转写结合精选的抽帧的图片后生成摘要。
- 图片分析：视频暂停时分析当前画面。
- 思维导图：根据音频、字幕和必要画面信息生成结构化导图。
- 继续对话：支持附件、历史会话、复制、翻译、点赞和点踩反馈。
- Skill 安装：用户可以上传或粘贴自己的 Skill JSON 来增强回答风格。
- 细节摘要和思维导图都是先由抓取的音频转文本，本地规则找“可能需要看画面”的关键词，AI 判断这些关键词（如这张图，结果如下等）是否真的引出重要画面，只在高置信度时间点附近抽帧，抽帧时间点大约为，
  关键词结束时间 + 大约 1.2 秒，关键词筛选，AI 判断是否真的需要看画面，关键词分数，只保留高分时间点，0.75 以上才抽帧，密集关键词合并，如果短时间内出现多个关键词，取分数最高的关键词。


## 项目结构

```text
apps/
  extension/   Edge/Chromium 扩展前端、content script、background worker
  server/      本地或自托管后端，负责 OSS 临时中转和 ASR 任务
packages/
  shared/      共享 schema、契约和视频长度工具
```

## 本地开发

```powershell
corepack enable
corepack pnpm install
corepack pnpm -r test
corepack pnpm -r typecheck
corepack pnpm --filter @app/extension build
corepack pnpm --filter @app/server dev
```

开发预览默认后端地址为 `http://127.0.0.1:3001`。扩展上架或给真实用户使用时，请让用户配置自己的后端，或者部署你自己的 HTTPS 后端。

## API 和 OSS 配置

本项目不内置任何 API Key。用户需要在扩展的 API 配置中填写：

- AI 供应商 API Key，例如 DashScope/Qwen、DeepSeek 等。
- 模型名，例如 `qwen-plus` 或兼容接口支持的模型。
- DashScope + OSS 转写后端 URL。
- 用户自己的 OSS AccessKeyId、AccessKeySecret、Region 和 Bucket。

安全建议：

- 不要把真实密钥写入源码、README、issue、commit 或截图。
- OSS 只作为临时中转，后端会在转写结束后删除临时对象。
- 建议给 OSS Key 配置最小权限，并限制只允许访问指定 bucket/prefix。

