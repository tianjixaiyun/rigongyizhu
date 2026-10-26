# rigongyizhu - GitHub Pages publisher (ASCII only: PowerShell 5.1 reads .ps1 as ANSI)
# usage: powershell -ExecutionPolicy Bypass -File .\publish.ps1 "commit message"
#
# token: prefer $env:GH_TOKEN, fall back to %TEMP%\gh_token.txt (single line, no quotes)
# The token is NEVER written into the remote URL or .git/config:
# it travels as a per-command http.extraheader, so nothing secret lands on disk.
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$msg = if ($args.Count -ge 1) { $args[0] } else { "deploy: $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }

$tok = $env:GH_TOKEN
$src = 'GH_TOKEN env'
if (-not $tok) {
  $tokFile = Join-Path $env:TEMP 'gh_token.txt'
  if (Test-Path $tokFile) { $tok = (Get-Content $tokFile -Raw).Trim(); $src = $tokFile }
}
if (-not $tok) {
  Write-Output 'missing token.'
  Write-Output '  set one of:  $env:GH_TOKEN  (recommended)'
  Write-Output '           or  %TEMP%\gh_token.txt'
  Write-Output 'Fine-grained PAT, repo tianjixaiyun/rigongyizhu, permission: Contents = Read and write'
  throw 'no GitHub token available'
}
$tok = $tok.Trim()
if ($tok -match '\s') { throw 'token contains whitespace, check the source' }

$owner = 'tianjixaiyun'; $repo = 'rigongyizhu'; $branch = 'main'
# clean remote, no credentials in it
$remote = "https://github.com/$owner/$repo.git"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

if (-not (Test-Path (Join-Path $here '.git'))) { git init -b $branch | Out-Null }

# always rewrite origin to the clean URL: this also scrubs any old token
# that earlier versions of this script had baked into .git/config
git remote get-url origin 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { git remote set-url origin $remote | Out-Null }
else { git remote add origin $remote | Out-Null }

# per-command credential, never persisted
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$tok"))
$auth = "AUTHORIZATION: basic $b64"

$okFetch = $false
for ($i = 1; $i -le 3; $i++) {
  git -c http.extraheader=$auth fetch origin $branch 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { $okFetch = $true; break }
  Write-Output "fetch failed (try $i/3), retrying..."
  Start-Sleep -Seconds 2
}
if (-not $okFetch) { throw 'git fetch failed after 3 tries (proxy 502?)' }

git reset --mixed "origin/$branch" 2>&1 | Out-Null
git add -A
$staged = (git diff --cached --name-only | Measure-Object).Count
if ($staged -eq 0) { Write-Output 'no changes, skip'; exit 0 }
git -c user.name='tianjixaiyun' -c user.email='mengwenjie111@qq.com' commit -m $msg 2>&1 | Out-Null

$okPush = $false
for ($i = 1; $i -le 3; $i++) {
  git -c http.extraheader=$auth push origin "HEAD:$branch" 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { $okPush = $true; break }
  Write-Output "push failed (try $i/3), retrying..."
  Start-Sleep -Seconds 2
}
if (-not $okPush) { throw 'git push failed after 3 tries' }

Write-Output ("pushed files: " + $staged + "  (token source: " + $src + ")")
Write-Output 'https://tianjixaiyun.github.io/rigongyizhu/'
