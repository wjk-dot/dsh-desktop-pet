# Cross-Platform Desktop Pet Release Plan

## Goal

Publish `@linxin666/dsh-desktop-pet` as one DeepSeek Harness plugin whose
Agent/session behavior is identical on macOS, Windows, and Linux. Each
platform must have an independently installable desktop companion rather than
depending on files in a developer checkout.

## Facts in the Current Repository

- `plugin/` is platform-neutral Node.js code. It owns the native DSH session,
  event projection, settings, bridge file, control API, and Qwen vision
  configuration.
- `companion/` is macOS-only Swift/AppKit code. It owns only the always-on-top
  pet window, tray menu, native screen selection, and clipboard integration.
- The existing default companion path points into the source checkout. It is
  suitable for development but cannot be used by an npm-installed plugin.

The publishable contract is therefore the HTTP/SSE bridge and pet web assets,
not the existing Swift binary.

## Target Layout

```text
plugin/                         # Published npm package; host/session layer
companion-web/                  # Shared pet page, protocol client, assets
companions/
  macos/                        # Swift shell until it is migrated
  windows/                      # Tauri shell
  linux/                        # Tauri shell
scripts/install-companion.mjs   # Resolves and installs a signed release asset
```

The companion protocol is versioned and platform-independent:

1. Read `$DSH_HOME/pet-bridge.json`.
2. Verify `/api/pet/health` and `instanceId`.
3. Subscribe to `/api/pet/events` with replay sequence support.
4. Use the existing control, preferences, chat, history, status, cancel, and
   vision endpoints.

No platform companion can create a second chat/session. The DSH plugin remains
the sole owner of the Agent execution chain.

## Delivery Order

### 1. Publishable Contract

- Add a `presentation` field to `/api/pet/config`: platform, companion state,
  and bridge protocol version.
- Replace source-checkout-only launch assumptions with a platform resolver.
- Add a settings-card warning when no companion is installed, with the exact
  install command rather than silently failing.
- Package the common pet page separately from the macOS app bundle.

### 2. Windows First

Build a Tauri 2 companion for `x86_64-pc-windows-msvc` and `aarch64-pc-windows-msvc`.
It reuses the web UI and talks only to the existing loopback endpoints.

Implementation status: the initial `companions/windows` Tauri 2 source tree is
present. It discovers the bridge lease, handles chat SSE, projects history,
preferences and Agent status, supports cancellation, and shares the macOS pet
page. The checked-in GitHub Actions workflow builds MSI and NSIS artifacts on
a Windows runner. Tray control, explicit region capture, window recovery and
signed public installers remain required before calling it feature-complete.

Required capabilities:

- frameless transparent always-on-top window;
- tray menu and show/hide control;
- drag, multi-monitor position persistence, and visible-area clamping;
- clipboard paste/copy through the WebView;
- user-initiated area capture using Windows Graphics Capture or a Tauri plugin.

Produce signed `.msi` and `.exe` installers. Windows SmartScreen reputation is
a release concern; unsigned binaries are not an acceptable end-user path.

### 3. Linux

Use the same Tauri shell for AppImage, `.deb`, and `.rpm` releases. Support X11
first. Wayland compositor policies can block global mouse monitoring,
always-on-top placement, and desktop-area capture, so these features must
degrade explicitly rather than claim universal behavior.

### 4. macOS Migration

Keep the current Swift app supported while Tauri reaches feature parity. Move
the existing pet page into `companion-web/`, then decide whether Swift remains
the macOS native shell or is replaced by Tauri. Preserve stable signing and
bundle identity so Screen Recording permissions are not invalidated on update.

### 5. Release Automation

GitHub Actions builds one signed artifact per platform, generates SHA-256
checksums, and publishes a versioned release manifest. The npm plugin ships no
large binary; `dsh-pet install-companion` downloads only the matching verified
asset. Plugin/companion compatibility is checked through a protocol version.

## Acceptance Matrix

| Capability | macOS | Windows | Linux X11 | Linux Wayland |
| --- | --- | --- | --- | --- |
| Same DSH Agent session | required | required | required | required |
| Always-on-top pet | required | required | required | best effort |
| Tray show/hide | required | required | required | compositor dependent |
| Clipboard paste/copy | required | required | required | required |
| User-selected screenshot | required | required | required | portal dependent |
| Tool status/cancel | required | required | required | required |

## Non-Goals

- Do not embed model credentials or a separate model runtime in a companion.
- Do not bypass DSH permission prompts from the pet.
- Do not claim feature parity on Wayland without compositor-specific testing.
