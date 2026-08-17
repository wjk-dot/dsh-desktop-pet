# DeepSeekPet for Windows

Windows companion based on Tauri 2. It reuses the pet page in
`companion/Resources/pet` and connects to the existing DSH plugin through the
local `pet-bridge.json` file. It never creates its own LLM chat or session.

## Prerequisites

- Windows 10 1809 or later
- Rust stable with the `x86_64-pc-windows-msvc` target
- Visual Studio 2022 Build Tools with the Desktop development with C++ workload
- WebView2 Runtime (preinstalled on current Windows 10/11)

## Development

Run this from a Windows checkout of the repository:

```powershell
./companions/windows/build.ps1
```

`tauri.conf.json` references the repository's shared pet page directly, so
changes under `companion/Resources/pet` are reflected in both the macOS and
Windows shells.

## Current Capability

- transparent, frameless, always-on-top window;
- drag, layout resizing, and host-controlled show/hide;
- DSH bridge discovery, health checks, chat SSE, history/status/preferences
  projection, cancellation, and clipboard support from WebView2;
- same `桌宠对话` DSH session as the full Harness desktop UI.

The explicit user-selected screenshot flow is wired into the shared UI, but the
Windows Graphics Capture selector, tray menu, position persistence, and
off-screen recovery are deliberately not claimed complete yet. Screenshot
requests return a clear in-app error until the native selector module is added.

## Packaging

```powershell
./companions/windows/build.ps1 -Release
```

The script installs the Tauri 2 CLI on first use. CI produces unsigned MSI and
NSIS artifacts on a `windows-v*` tag or a manually triggered workflow; public
releases still require code signing.

Release artifacts must be code-signed before public distribution. Do not ask
end users to bypass SmartScreen for an unsigned package.
