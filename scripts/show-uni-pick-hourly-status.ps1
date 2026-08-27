param([Parameter(Mandatory=$true)][string]$StatusFile)
$ErrorActionPreference = 'Stop'
try {
  $s = Get-Content -LiteralPath $StatusFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $src = $s.sourceValidation
  $title = 'UNI PICK 자동화 진행 상황'
  if ($s.phase -eq 'source_validation' -or $s.phase -eq 'source_retry') {
    $message = "현재 작업:`n$($s.phaseLabel)`n`n진행: $($src.completed) / $($src.total)`n현재 대학: $($src.currentUniversityId)`n자동 승인: $($src.autoApproved)개`n검토 필요: $($src.review)개`n오류: $($src.error)개`n`n다음 뉴스 수집: 16:30`n시스템 상태: 정상"
  } else {
    $message = "현재 작업:`n다음 예약 작업 대기`n`n검증 대학: $($src.completed)개`n활성 뉴스 출처: $($s.newsCollection.targetCount)개`n다음 뉴스 수집: 16:30`n시스템 상태: 정상 대기"
  }
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show($message, $title, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
} catch { Write-Error $_.Exception.Message; exit 0 }
