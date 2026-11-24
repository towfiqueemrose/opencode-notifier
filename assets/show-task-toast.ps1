param(
  [string]$Title = $env:OPENCODE_ALERT_TITLE,
  [string]$Message = $env:OPENCODE_ALERT_MESSAGE,
  [string]$AppId = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe",
  [switch]$Verify
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Title)) { $Title = "OpenCode Task Completed" }
if ([string]::IsNullOrWhiteSpace($Message)) { $Message = "Agent finished" }
if ($Title.Length -gt 80) { $Title = $Title.Substring(0, 80) }
if ($Message.Length -gt 240) { $Message = $Message.Substring(0, 240) }

function ConvertTo-XmlText([string]$Value) {
  return [System.Security.SecurityElement]::Escape($Value)
}

try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $xml.LoadXml(@"
<toast duration="long" scenario="default">
  <visual>
    <binding template="ToastGeneric">
      <text>$(ConvertTo-XmlText $Title)</text>
      <text>$(ConvertTo-XmlText $Message)</text>
    </binding>
  </visual>
  <audio silent="true" />
</toast>
"@)

  $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
  $toast.Tag = "opencode-task"
  $toast.Group = "opencode"
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($AppId).Show($toast)

  if ($Verify) {
    Start-Sleep -Milliseconds 600
    $history = [Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($AppId)
    Write-Output "toast-accepted=$($history.Count -gt 0) history-count=$($history.Count)"
  }
} catch {
  Write-Output "toast-error: $($_.Exception.Message)"
  exit 1
}
