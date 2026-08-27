param([Parameter(Mandatory = $true)][string]$ResultFile)
function T([string]$s) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) }
try {
  $r = Get-Content -LiteralPath $ResultFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $title = T 'VU5JIFBJQ0sg64yA7ZWZIOy2lOqwgCDsp4Ttlokg7IOB7Zlc'
  $message = "$(T '64yA7ZWZIOy2lOqwgCDsnpHsl4UgMTDrsJgg7JmE66OM')`n`n$(T '7LKY66as'): $($r.batchStart) ~ $($r.batchEnd)`n$(T '7J6Q64+ZIOyKueyduA=='): $($r.autoApproved)`n$(T '6rKA7YagIO2VhOyalA=='): $($r.review)`n$(T '7Jik66WY'): $($r.error)`n$(T '64Sk7Yq47JuM7YGsIOyYpOulmA=='): $($r.networkErrors)`n`nGitHub: $($r.git.status)"
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($message, $title, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
} catch { }
