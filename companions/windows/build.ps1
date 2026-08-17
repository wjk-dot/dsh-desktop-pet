[CmdletBinding()]
param(
  [switch]$Release
)

$ErrorActionPreference = 'Stop'
$tauriRoot = Join-Path $PSScriptRoot 'src-tauri'

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw 'Rust stable is required. Install it from https://rustup.rs/ and reopen PowerShell.'
}

Push-Location $tauriRoot
try {
  & cargo tauri --version 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'Installing Tauri CLI 2.x...'
    & cargo install tauri-cli --version '^2' --locked
  }

  if ($Release) {
    & cargo tauri build
  } else {
    & cargo tauri dev
  }
} finally {
  Pop-Location
}
