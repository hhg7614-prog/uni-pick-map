param([switch]$Interactive)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
node 'server/agent/tools/run-scheduled-news-update.js'
$exitCode = $LASTEXITCODE
$result = Join-Path $root 'server/agent/runtime/news-update-result.json'
$popup = Join-Path $root 'scripts/show-uni-pick-agent-result.ps1'
if (Test-Path -LiteralPath $result) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $popup -ResultFile $result }
$report = Join-Path $root 'server/agent/news/reports/ui/latest-news-update-report.html'
if ($Interactive -and (Test-Path -LiteralPath $report)) {
  try { Start-Process -FilePath $report } catch { Write-Output 'REPORT_OPEN_SKIPPED' }
} else { Write-Output 'REPORT_OPEN_SKIPPED' }
exit $exitCode
