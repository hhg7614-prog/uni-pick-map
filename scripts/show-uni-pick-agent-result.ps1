param([Parameter(Mandatory = $true)][string]$ResultFile)
function D([string]$v) { return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($v)) }
function V($o,[string]$n,$d) { if ($null -ne $o.PSObject.Properties[$n]) { return $o.$n }; return $d }
try {
  Add-Type -AssemblyName System.Windows.Forms
  $r = Get-Content -LiteralPath $ResultFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $status = ([string](V $r 'status' 'FAILED')).ToUpperInvariant()
  $isOnboarding = ([string](V $r 'agent' 'news-update')) -eq 'onboarding'
  if ($isOnboarding) {
    if ($status -eq 'SUCCESS' -or $status -eq 'NO_CHANGES') { $title = D 'VU5JIFBJQ0sg64yA7ZWZIOqygOymnSDsmYTro4w=' } elseif ($status -eq 'WARNING') { $title = D 'VU5JIFBJQ0sg64yA7ZWZIOqygOymnSDtmZXsnbgg7ZWE7JqU' } else { $title = D 'VU5JIFBJQ0sg64yA7ZWZIOqygOymnSDsi6TtjKg=' }
    $message = (D '64yA7ZWZIOqygOymnSDsnpHsl4XsnbQg7JmE66OM65CY7JeI7Iq164uI64ukLg==') + "`n`n" + (D '7LKY66asIOuMgO2VmQ==') + ": $(V $r 'processed' 0)" + "`n" + (D '64Sk7Yq47JuM7YGsIOuzteq1rA==') + ": $(V $r 'recovered' 0)" + "`n" + (D '7Zmc7ISx7ZmUIOykgOu5hA==') + ": $(V $r 'activationReady' 0)" + "`n" + (D '67O066WY') + ": $(V $r 'hold' 0)" + "`n" + (D '64Ko7J2AIFJldHJ5') + ": $(V $r 'retryRemaining' 0)" + "`n" + (D 'VmVyaWZpZWQ=') + ": $(V $r 'verified' 0)" + "`n`n" + (D '7JWI7KCEIOyhsOqxtOydhCDthrXqs7ztlZjsp4Ag66q77ZWcIOuMgO2VmeydgCDsnpDrj5kg7Zmc7ISx7ZmU7ZWY7KeAIOyViuyVmOyKteuLiOuLpC4=')
  } else { $title = 'UNI PICK News Update'; $message = [string](V $r 'messageKo' 'Completed') }
  $icon = if ($status -eq 'WARNING') { [System.Windows.Forms.MessageBoxIcon]::Warning } elseif ($status -eq 'FAILED') { [System.Windows.Forms.MessageBoxIcon]::Error } else { [System.Windows.Forms.MessageBoxIcon]::Information }
  [void][System.Windows.Forms.MessageBox]::Show($message,$title,[System.Windows.Forms.MessageBoxButtons]::OK,$icon)
} catch { exit 1 }
