param([string]$ProjectRoot = 'D:\hhg(code)')
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $self = $PSCommandPath
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $self), '-ProjectRoot', ('"{0}"' -f $ProjectRoot))
  Write-Host '관리자 승인 창이 열렸습니다. 승인 후 작업 스케줄러 등록이 계속됩니다.'
  exit 0
}
$ErrorActionPreference = 'Stop'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$watchdog = Join-Path $ProjectRoot 'server\agent\tools\uni-pick-watchdog.js'
$status = Join-Path $ProjectRoot 'server\agent\tools\build-hourly-status.js'
$popup = Join-Path $ProjectRoot 'scripts\show-uni-pick-hourly-status.ps1'
function Set-UniTask($Name, $Action, $Trigger) { Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Trigger -RunLevel Limited -Force | Out-Null }
$newsBat = Join-Path $ProjectRoot 'scripts\run-six-university-news.local.bat'
Set-UniTask 'UNI PICK News Morning' (New-ScheduledTaskAction -Execute $newsBat) (New-ScheduledTaskTrigger -Daily -At 9:30AM)
Set-UniTask 'UNI PICK News Afternoon' (New-ScheduledTaskAction -Execute $newsBat) (New-ScheduledTaskTrigger -Daily -At 4:30PM)
Unregister-ScheduledTask -TaskName 'UNI PICK News Evening' -Confirm:$false -ErrorAction SilentlyContinue
$nextHour = (Get-Date).AddHours(1)
$nextHour = $nextHour.Date.AddHours($nextHour.Hour)
$hour = New-ScheduledTaskTrigger -Once -At $nextHour -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 1)
Set-UniTask 'UNI PICK System Watchdog' (New-ScheduledTaskAction -Execute $node -Argument ('"' + $watchdog + '"') -WorkingDirectory $ProjectRoot) @($hour,(New-ScheduledTaskTrigger -AtLogOn))
Set-UniTask 'UNI PICK Hourly Status' (New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -Command "& { node ''' + $status + ''' | Out-Null; & ''' + $popup + ''' -StatusFile ''' + (Join-Path $ProjectRoot 'server\agent\data\uni-pick-system-status.json') + ''' }"') -WorkingDirectory $ProjectRoot) $hour
Get-ScheduledTask -TaskName 'UNI PICK News Morning','UNI PICK News Afternoon','UNI PICK System Watchdog','UNI PICK Hourly Status' | Select-Object TaskName,State
