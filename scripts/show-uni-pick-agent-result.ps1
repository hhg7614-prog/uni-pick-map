param([Parameter(Mandatory = $true)][string]$ResultFile)

function N($o, [string]$name, $default = 0) { if ($null -ne $o.PSObject.Properties[$name]) { return $o.$name }; return $default }
try {
  Add-Type -AssemblyName System.Windows.Forms
  $r = Get-Content -LiteralPath $ResultFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $status = ([string](N $r 'status' 'FAILED')).ToUpperInvariant()
  $agent = [string](N $r 'agent' 'news-update')
  if ($agent -eq 'onboarding') { $base = 'UNI PICK 대학 검증' } else { $base = 'UNI PICK 뉴스 업데이트' }
  $processed = N $r 'processed' 0; $success = N $r 'success' 0; $failed = N $r 'failed' 0
  if ($status -eq 'SUCCESS') {
    $title = "$base 완료"; $message = "$base가 완료되었습니다.`n`n처리: ${processed}개`n성공: ${success}개`n실패: ${failed}개`n신규 항목: $(N $r 'newItems' 0)건`n중복 제외: $(N $r 'duplicates' 0)건`n`n배포: $(N $r 'pushStatus' '실행하지 않음')"
    $icon = [System.Windows.Forms.MessageBoxIcon]::Information
  } elseif ($status -eq 'NO_CHANGES') {
    $title = "$base 완료"; $message = "새로운 항목이 없습니다.`n`n처리: ${processed}개`n오류: ${failed}개`n`n다음 자동 실행: $(N $r 'nextRun' '예약 시간에 실행')"; $icon = [System.Windows.Forms.MessageBoxIcon]::Information
  } elseif ($status -eq 'WARNING') {
    $title = "$base 확인 필요"; $message = "$base는 완료되었지만 검토가 필요한 항목이 있습니다.`n`n처리: ${processed}개`n신규 항목: $(N $r 'newItems' 0)건`n오류: ${failed}개`n`n자동 배포는 중단되었습니다.`n상세 HTML 보고서를 확인해 주세요."; $icon = [System.Windows.Forms.MessageBoxIcon]::Warning
  } else {
    $title = "$base 실패"; $message = "$base 실행 중 오류가 발생했습니다.`n`n오류: $([string](N $r 'messageKo' (N $r 'error' '알 수 없는 오류')))`n`n배포: 실행하지 않음`n상세 HTML 보고서를 확인해 주세요."; $icon = [System.Windows.Forms.MessageBoxIcon]::Error
  }
  [void][System.Windows.Forms.MessageBox]::Show($message, $title, [System.Windows.Forms.MessageBoxButtons]::OK, $icon)
} catch { }
