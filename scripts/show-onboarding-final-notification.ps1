param([Parameter(Mandatory = $true)][string]$ResultFile)
try {
  $r = Get-Content -LiteralPath $ResultFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $title = 'UNI PICK 대학 검증 완료'
  $message = "처리 대학: $($r.totalUniversities)개`n자동 승인: $($r.autoApproved)개`n기존 검증 건너뜀: $($r.existingVerifiedSkip)개`n추가 검토 필요: $($r.finalReviewRequired)개`n최종 오류: $($r.finalError)개"
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($message, $title, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
} catch { }
