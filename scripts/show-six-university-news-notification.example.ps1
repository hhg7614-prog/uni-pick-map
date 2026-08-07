param(
  [Parameter(Mandatory = $true)]
  [string]$ResultFile
)

# Copy this file to show-six-university-news-notification.ps1 for local use.
# The local file is intentionally ignored by Git.

function Write-NotificationError([string]$Message) {
  try {
    $directory = Split-Path -Parent $ResultFile
    $logFile = Join-Path $directory "notification-errors.log"
    Add-Content -LiteralPath $logFile -Value ("{0} {1}" -f (Get-Date -Format "s"), $Message) -Encoding UTF8
  } catch {
    # Notification failures must not change the news job result.
  }
}

function Get-ResultValue($Object, [string[]]$Names, $DefaultValue) {
  foreach ($name in $Names) {
    $property = $Object.PSObject.Properties[$name]
    if ($null -ne $property -and $null -ne $property.Value) {
      return $property.Value
    }
  }

  return $DefaultValue
}

try {
  Add-Type -AssemblyName System.Windows.Forms

  $result = Get-Content -LiteralPath $ResultFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $status = ([string](Get-ResultValue $result @('status') '')).Trim().ToLowerInvariant()
  $previewCount = [int](Get-ResultValue $result @('previewCount', 'previewAfter') 0)
  if ($previewCount -eq 0 -and $null -ne $result.PSObject.Properties['result']) {
    $previewCount = [int](Get-ResultValue $result.result @('previewCount') 0)
  }

  $newTotal = [int](Get-ResultValue $result @('newCount', 'newTotal', 'savedCount') 0)
  if ($newTotal -eq 0 -and $null -ne $result.PSObject.Properties['saveResult']) {
    $newTotal = [int](Get-ResultValue $result.saveResult @('savedCount') 0)
  }

  $pushed = [bool]$result.pushed
  $failedStatuses = @('failed', 'error', 'validation_failed', 'collection_failed', 'push_failed')
  $successfulStatuses = @('success', 'updated', 'deployed')

  if ($status -eq 'no_new_items' -or (($successfulStatuses -contains $status) -and -not $pushed -and $newTotal -eq 0)) {
    $title = 'UNI PICK 뉴스 업데이트'
    $message = "No new university news was found.`nCurrent public news count: $previewCount"
    $icon = [System.Windows.Forms.MessageBoxIcon]::Information
  } elseif ($successfulStatuses -contains $status -and $pushed) {
    $title = 'UNI PICK 뉴스 업데이트 완료'
    $message = "Added $newTotal new university news item(s).`nGitHub was updated successfully.`nRender is refreshing the public site."
    $icon = [System.Windows.Forms.MessageBoxIcon]::Information
  } elseif ($status -eq 'push_failed' -or (($successfulStatuses -contains $status) -and -not $pushed -and $newTotal -gt 0)) {
    $title = 'UNI PICK GitHub 반영 실패'
    $message = "News collection completed, but GitHub push failed.`nPlease check the log file."
    $icon = [System.Windows.Forms.MessageBoxIcon]::Error
  } elseif ($failedStatuses -contains $status) {
    $title = 'UNI PICK 뉴스 업데이트 실패'
    $message = "News collection or validation failed.`nPlease check the log file."
    $icon = [System.Windows.Forms.MessageBoxIcon]::Error
  } else {
    $title = 'UNI PICK 뉴스 업데이트 확인 필요'
    $message = "The scheduled result format could not be verified.`nPlease check the log file."
    $icon = [System.Windows.Forms.MessageBoxIcon]::Warning
  }

  [System.Windows.Forms.MessageBox]::Show($message, $title, [System.Windows.Forms.MessageBoxButtons]::OK, $icon) | Out-Null
} catch {
  Write-NotificationError $_.Exception.Message
}

exit 0
