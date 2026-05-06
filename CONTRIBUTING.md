# Contributing

欢迎提交 issue 和 pull request。

## 开发流程

```powershell
corepack enable
corepack pnpm install
corepack pnpm -r test
corepack pnpm -r typecheck
corepack pnpm --filter @app/extension build
```

## 提交前检查

- 不提交 `.env`、`.tmp`、测试音频、zip 包、构建产物或真实密钥。
- 新功能尽量补测试。
- UI 文案需要同时考虑中文和英文。
- 涉及 Bilibili 音频抓取、OSS、ASR 的修改需要验证失败提示是否清晰。

## 版权和合规

本项目只提供用户主动触发的学习辅助能力。请不要把扩展用于批量下载、未授权分发或长期存储第三方内容。
