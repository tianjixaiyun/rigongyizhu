# rigongyizhu - GitHub Pages publisher (ASCII only: PowerShell 5.1 reads .ps1 as ANSI)
# usage: powershell -ExecutionPolicy Bypass -File .\publish.ps1 "commit message"
# token: %TEMP%\gh_token.txt (single line, no quotes)
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$msg = if ($args.Count -ge 1) { $args[0] } else { "deploy: $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
$tokFile = Join-Path $env:TEMP 'gh_token.txt'
if (-not (Test-Path $tokFile)) { throw "missing token file: $tokFile" }
$tok = (Get-Content $tokFile -Raw).Trim()
if (-not $tok) { throw "empty token file: $tokFile" }

$owner = 'tianjixaiyun'; $repo = 'rigongyizhu'; $branch = 'main'
$remote = "https://x-access-token:$tok@github.com/$owner/$repo.git"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

if (-not (Test-Path (Join-Path $here '.git'))) { git init -b $branch | Out-Null }

git remote get-url origin 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { git remote set-url origin $remote | Out-Null }
else { git remote add origin $remote | Out-Null }

git fetch origin $branch 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "git fetch failed" }
git reset --mixed "origin/$branch" 2>&1 | Out-Null
git add -A
$staged = (git diff --cached --name-only | Measure-Object).Count
if ($staged -eq 0) { Write-Output 'no changes, skip'; exit 0 }
git -c user.name='tianjixaiyun' -c user.email='mengwenjie111@qq.com' commit -m $msg 2>&1 | Out-Null
git push origin "HEAD:$branch" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "git push failed" }
Write-Output ("pushed files: " + $staged)
Write-Output 'https://tianjixaiyun.github.io/rigongyizhu/'
