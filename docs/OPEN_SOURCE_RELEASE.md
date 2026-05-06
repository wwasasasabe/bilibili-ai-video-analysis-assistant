# 开源发布指南

## 1. 发布前检查

```powershell
git status --short
rg -n "sk-[A-Za-z0-9]{20,}|LTAI[A-Za-z0-9]{12,}|OSS_ACCESS_KEY_SECRET\s*=\s*[^\s#]+|DASHSCOPE_API_KEY\s*=\s*[^\s#]+" -S . --glob "!node_modules/**" --glob "!.git/**"
corepack pnpm -r test
corepack pnpm -r typecheck
corepack pnpm --filter @app/extension build
```

确认不要提交：

- `.env` / `.env.*`
- `.tmp/`
- `tmp-audio-tests/`
- `apps/**/dist`
- `*.zip`
- 真实 API Key、OSS Key、Cookie、签名 URL

## 2. 一键发布

先登录 GitHub CLI：

```powershell
gh auth login
gh auth status
```

运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/open-source-publish.ps1 -RepoName bilibili-ai-video-analysis-assistant
```

默认会创建 public repository。

## 3. 手动发布

```powershell
git add .
git commit -m "Initial open source release"
gh repo create bilibili-ai-video-analysis-assistant --public --source . --remote origin --push
```

如果远程仓库已经存在：

```powershell
git remote add origin https://github.com/<your-name>/bilibili-ai-video-analysis-assistant.git
git branch -M main
git push -u origin main
```

## 4. GitHub 仓库建议设置

- About: `Bilibili AI video analysis assistant Edge extension`
- Topics: `bilibili`, `edge-extension`, `browser-extension`, `ai`, `dashscope`, `oss`, `qwen`
- 勾选 Issues。
- 如果要接受 PR，开启 branch protection 和 required status checks。
