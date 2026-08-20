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
- compact transparent window with native hit testing: empty canvas areas pass
  mouse input through while visible controls remain interactive;
- Windows region capture with Escape cancellation, multi-monitor selector
  bounds, temporary JPEG storage, and deferred `/api/pet/vision` submission.

The selector uses the Windows desktop capture path exposed by the `screenshots`
crate. On systems with privacy controls or a policy-blocked desktop capture,
the native call returns an error and the pet reports it instead of submitting
an empty image. The first capture can also be delayed by WebView2 focus on
multi-monitor, mixed-DPI desktops; select using the full-screen overlay and
press Escape to cancel.

## Packaging

```powershell
./companions/windows/build.ps1 -Release
```

The script installs the Tauri 2 CLI on first use. CI currently produces an
unsigned NSIS `.exe` installer on a `windows-v*` tag or a manually triggered
workflow; public releases still require code signing. MSI can be built locally
after WiX is available, but CI intentionally uses NSIS first because it is the
fastest path to a reproducible downloadable artifact.

Release artifacts must be code-signed before public distribution. Do not ask
end users to bypass SmartScreen for an unsigned package.

## 手动运行 CI 构建（Build Windows companion）

工作流 `.github/workflows/windows-companion.yml` 支持手动触发：

1. 打开仓库 → **Actions** 页签 → 左侧选 **Build Windows companion**
2. 右侧 **Run workflow** 下拉 → 选分支（默认 `main`）→ 绿色 **Run workflow**
3. 点击进入该次运行，等待 `build` 作业完成

**验证"真实编译"的判定**：

- 作业全绿 = `cargo tauri build --bundles nsis` 真实通过了 MSVC + WebView2 的完整编译/打包
- `Upload installers` 步骤 `if-no-files-found: error`——没有产出 MSI/NSIS 会直接失败
- 运行页底部 **Artifacts** 区出现 `DeepSeekPet-Windows` 下载包即产物有效
- 如果运行页显示 `Failure`，且 **Artifacts** 是 `-`，说明安装器没有生成。这个页面
  不能用于判断 Windows 桌宠运行效果，必须先修复构建或重跑 workflow。

常见失败点：`.ico` 图标缺失（已入库 `icons/icon.ico`）；`cargo install tauri-cli`
首次较慢属正常；MSI 需要 WiX 工具集，NSIS 由 tauri 自动拉取。

## Windows 实机联调

### 前置：让 Windows 端能连上 DSH 插件

Windows 伴生应用通过 `%USERPROFILE%\.dsh\pet-bridge.json` 发现宿主（端口、
instanceId、expiresAt、enabled）。桌面上没有 DSH 桌面应用时，二选一：

- **方案 A（推荐）**：在 Windows 机装 Node ≥ 22，把 `plugin/` 以 `link:` 加入
  profile 后跑 `dsh web`（headless 宿主即可），插件启动时写入真实桥文件。
- **方案 B**：手工放置桥文件（仅调试用），指向可到达的宿主
  `{"port":<host端口>,"instanceId":"<任意非空>","expiresAt":<未来毫秒时间戳>,"enabled":true}`。

### 联调步骤

1. CI 运行成功 → 下载 `DeepSeekPet-Windows` 工件 → 解压得到 NSIS `.exe`
2. 在实机双击安装；如果要静默安装，使用安装器支持的 `/S` 参数
3. 启动 DeepSeekPet，验证：透明置顶窗口出现 → 点桌宠 → 输入框 → 对话 SSE 流式
4. 排查工具：
   - `Get-Content "$env:USERPROFILE\.dsh\pet-bridge.json"` 确认插件桥文件存在
   - `Get-Content "$env:USERPROFILE\.dsh\pet-desktop.json"` 确认 `enabled: true`
   - `Get-Process DeepSeekPet -ErrorAction SilentlyContinue` 确认 companion 进程存在
   - `Test-Path "$env:LOCALAPPDATA\DeepSeekPet\DeepSeekPet.exe"` 检查常见 NSIS 安装路径
   - `Test-Path "$env:LOCALAPPDATA\Programs\DeepSeekPet\DeepSeekPet.exe"` 检查常见 per-user 安装路径
   - `curl http://127.0.0.1:<port>/api/pet/health` 确认插件在线
   - 检查 `%USERPROFILE%\.dsh\pet-bridge.json` 字段是否与上面对齐
   - WebView2 开发者工具：`tauri.conf.json` 已开 `withGlobalTauri`，
     可在 Rust 侧临时 `window.open_devtools()` 或加日志
5. Windows 截图选择器支持区域框选和 Escape 取消；托盘菜单、位置持久化、
   屏幕外恢复仍不属于本任务范围

### 建议的 CI 冒烟验证（可选增强）

在 `build` 作业后加一步解压 NSIS 产物或直接使用 `tauri-apps/tauri-action`
做 smoke；如需"能启动"级验证，需要 Windows 自托管 runner 实机跑一次安装并
启动程序探活（GitHub 托管的 runner 无交互桌面，只能验证编译与打包产物）。
