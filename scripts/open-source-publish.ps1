param(
  [string]$RepoName = "bilibili-ai-video-analysis-assistant",
  [string]$CommitMessage = "Initial open source release",
  [switch]$Private
)

$ErrorActionPreference = "Stop"

function Run($Command, $Arguments) {
  Write-Host ">" $Command $Arguments
  & $Command @Arguments
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git is required."
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI (gh) is required. Install it and run: gh auth login"
}

Run gh @("auth", "status")

$secretHits = & rg -n "sk-[A-Za-z0-9]{20,}|LTAI[A-Za-z0-9]{12,}|OSS_ACCESS_KEY_SECRET\s*=\s*[^\s#]+|DASHSCOPE_API_KEY\s*=\s*[^\s#]+" -S . --glob "!node_modules/**" --glob "!.git/**" --glob "!.tmp/**" --glob "!tmp-audio-tests/**"
if ($LASTEXITCODE -eq 0 -and $secretHits) {
  Write-Host $secretHits
  throw "Potential secret-like text found. Review the lines above before publishing."
}

Run corepack @("pnpm", "-r", "test")
Run corepack @("pnpm", "-r", "typecheck")
Run corepack @("pnpm", "--filter", "@app/extension", "build")

$status = git status --short
if (-not $status) {
  Write-Host "No changes to publish."
} else {
  Run git @("add", ".")
  Run git @("commit", "-m", $CommitMessage)
}

$visibility = if ($Private) { "--private" } else { "--public" }
$hasRemote = git remote get-url origin 2>$null

if (-not $hasRemote) {
  Run gh @("repo", "create", $RepoName, $visibility, "--source", ".", "--remote", "origin", "--push")
} else {
  Run git @("branch", "-M", "main")
  Run git @("push", "-u", "origin", "main")
}

Write-Host "Published. Open with:"
Run gh @("repo", "view", "--web")
