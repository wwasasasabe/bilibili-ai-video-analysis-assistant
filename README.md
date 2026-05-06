# B站AI视频分析助手

面向 Bilibili 视频学习场景的 Edge/Chromium 侧边栏 AI 扩展。它可以在视频页中生成快速摘要、细节摘要、图片分析、继续对话、思维导图，并支持用户安装自定义 Skill。

## 功能亮点

- 快速摘要：基于页面字幕、笔记和上下文快速概括视频重点。
- 细节摘要：在真实浏览器环境中抓取 B站音频，临时上传到用户配置的 OSS，经 DashScope ASR 转写后生成时间轴摘要。
- 图片分析：视频暂停时分析当前画面。
- 思维导图：根据音频、字幕和必要画面信息生成结构化导图。
- 继续对话：支持附件、历史会话、复制、翻译、点赞和点踩反馈。
- Skill 安装：用户可以上传或粘贴自己的 Skill JSON 来增强回答风格。
- 多供应商：支持 Qwen、DeepSeek、GLM、MiniMax、MiMo、Kimi 和自定义 OpenAI 兼容接口。

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

## 构建扩展

```powershell
corepack pnpm --filter @app/extension build
```

构建产物在 `apps/extension/dist`。上架商店时只压缩 `dist` 目录里的内容，不要把源码、`.env`、`.tmp`、测试音频或本地日志打包进去。

## 开源发布

先确认你已经安装并登录 GitHub CLI：

```powershell
gh auth status
```

然后运行一键发布脚本：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/open-source-publish.ps1 -RepoName bilibili-ai-video-analysis-assistant
```

脚本会执行基础安全扫描、测试、类型检查、构建、创建 GitHub public repo、提交并推送代码。

如果你只想手动发布，请看 [开源发布指南](docs/OPEN_SOURCE_RELEASE.md)。

## 隐私政策

商店用隐私政策在 `apps/extension/store/privacy-policy.html`。如果你已经部署到 GitHub Pages，请在商店后台填写对应 URL。

## License

MIT
