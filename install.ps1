param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$config = if ($env:XDG_CONFIG_HOME) {
  Join-Path $env:XDG_CONFIG_HOME "opencode"
} else {
  Join-Path $HOME ".config\opencode"
}
$dest = Join-Path $config "plugins\opencode-notifier"

if (Test-Path $dest) {
  if (-not $Force) {
    $answer = Read-Host "opencode-notifier is already installed at $dest. Replace it? [y/N]"
    if ($answer -notmatch '^(y|yes)$') {
      Write-Host "Cancelled."
      exit 1
    }
  }
  Remove-Item -Recurse -Force $dest
}

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item (Join-Path $root "src") $dest -Recurse
Copy-Item (Join-Path $root "assets") $dest -Recurse
Copy-Item (Join-Path $root "package.json") $dest
Copy-Item (Join-Path $root "README.md") $dest
Copy-Item (Join-Path $root "LICENSE") $dest

Write-Host ""
Write-Host "Installed opencode-notifier to $dest"
Write-Host "Restart OpenCode, then run /task-alert-setup in the TUI."
Write-Host ""

if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) {
  Write-Warning "The 'opencode' command was not found on PATH. Install OpenCode 2.4+ before using the plugin."
}
