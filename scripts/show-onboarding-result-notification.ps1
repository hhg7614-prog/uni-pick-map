param([Parameter(Mandatory = $true)][string]$ResultFile)

function Text([string]$base64) {
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($base64))
}

try {
  $result = Get-Content -LiteralPath $ResultFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $name = [string]$result.universityName
  if ($result.finalStatus -eq 'SUCCESS' -or $result.finalStatus -eq 'SUCCESS_NO_PUSH') {
    $title = Text 'VU5JIFBJQ0sg64yA7ZWZIOy2lOqwgCDsmYTro4w='
    $message = "$name`n$(Text '6rO17IudIOy2nOyymCDqsoDspp3qs7wg7IiY7KeRIO2FjOyKpO2KuOqwgCDsmYTro4zrkJjsl4jsirXri4jri6Qu')"
  } elseif ($result.finalStatus -like 'SKIPPED*') {
    $title = Text 'VU5JIFBJQ0sg64yA7ZWZIOy2lOqwgCDtmZXsnbg='
    $message = "$name`n$(Text '7J2066+4IOqygOymneuQnCDstpzsspjqsIAg7J6I7Ja0IOuzgOqyve2VmOyngCDslYrslZjsirXri4jri6Qu')"
  } elseif ($result.finalStatus -like 'REVIEW*') {
    $title = Text 'VU5JIFBJQ0sg64yA7ZWZIOy2lOqwgCDqsoDthqAg7ZWE7JqU'
    $message = "$name`n$(Text '7J6Q64+ZIOyKueyduCDquLDspIDsnYQg66qo65GQIOy2qeyhse2VmOyngCDslYrslYQg67OA6rK97ZWY7KeAIOyViuyVmOyKteuLiOuLpC4=')"
  } else {
    $title = Text 'VU5JIFBJQ0sg64yA7ZWZIOy2lOqwgCDsi6TtjKg='
    $message = "$name`n$(Text '7KeE64uoIOykkSDsmKTrpZjqsIAg67Cc7IOd7ZaI7Iq164uI64ukLiDrs7Tqs6DshJzrpbwg7ZmV7J247ZW0IOyjvOyEuOyalC4=')"
  }
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($message, $title, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
} catch { }
