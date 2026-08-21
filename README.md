# DeepSeek Harness Desktop Pet

> 一个连接到 DeepSeek Harness 原生 Agent 的桌面宠物。它不是第二个聊天机器人：桌宠和 Harness 工作区里的 `桌宠对话` 是同一条完整 Agent 执行链，可在任一端继续对话、使用工具、查看历史或取消任务。

## 它能做什么

- 常驻桌面：macOS 使用 Swift/AppKit 创建透明、无边框、置顶窗口，Windows 使用 Tauri 2 + WebView2 创建对应的悬浮窗口；两端都可点击桌宠展开输入框和对话气泡。
- 同一条 Agent 会话：桌宠、Harness 左侧工作区的 `桌宠对话`、工具调用、任务状态与取消共用同一个 DSH native session，不复制或分叉上下文。macOS 端还可以从菜单栏重新显示桌宠或刷新会话。
- 双端任务投影：无论任务从桌宠还是完整 Harness 发起，macOS 和 Windows 桌宠都会通过 SSE 显示思考、工具活动和执行状态；macOS 端可直接请求取消当前 turn。
- 富文本气泡：共享 Web UI 支持 Markdown、代码高亮、表格和 KaTeX 公式；macOS 原生菜单和 WKWebView responder chain 支持输入框粘贴，气泡内容可复制。
- 插件配置：在 Harness 的 `设置 -> 插件 -> DeepSeek 桌宠` 调整启用状态、图标大小、任务状态、动画、贴边和视觉功能；配置同时作用于 macOS 和 Windows companion。
- 可选 Qwen 视觉：macOS 可通过系统截图选择器自主框选区域，先在输入框输入问题再发送给 Qwen 多模态 MCP；Windows 当前可使用 Harness 桌面端视觉工作流。分析过程和结论都会回到同一 Agent 会话。

## 平台状态

| 平台 | 桌宠壳 | 可用能力 | 状态 |
| --- | --- | --- | --- |
| macOS 13+ | Swift + AppKit + WKWebView | 透明悬浮、拖动、菜单栏开关、历史、任务状态、取消、贴边隐藏、用户框选截图、系统粘贴/复制 | 已可用 |
| Windows 10 1809+ | Tauri 2 + WebView2 | 悬浮、拖动、聊天 SSE、历史、任务状态、取消、粘贴/复制 | 源码 MVP，需在 Windows 构建验证 |
| Linux | 未提供 | 插件的 `桌宠对话` session 仍可在 Harness 中使用 | 未开始 |

macOS 版本是当前本机已验证的完整 companion：使用 Swift 原生窗口、菜单栏状态项、WKWebView 和 `/usr/sbin/screencapture`。Windows 目前没有发布已签名的安装包。仓库已经包含 MSI/NSIS 的 CI 构建配置，但 Windows 系统托盘、框选截图、多屏位置恢复和代码签名尚未完成，Windows 仍应视为源码 MVP。

## 架构

```text
DeepSeek Harness host
  |
  | Cordis plugin: plugin/
  | - apiProxy.sessions 驱动唯一 native Agent session
  | - HTTP loopback: /api/pet/chat, /history, /status, /cancel, /preferences
  | - SSE: 增量回复、工具状态和可恢复事件流
  | - $DSH_HOME/pet-bridge.json: 随机端口、instanceId、租约、开关
  v
platform companion
  macOS: Swift/AppKit + WKWebView
  Windows: Rust/Tauri 2 + WebView2
  |
  v
shared pet web UI
  HTML/CSS/JS + Markdown + KaTeX + highlight.js + DOMPurify
```

这里用了几件关键技术：

- **Cordis 的可组合生命周期**：host 路由、会话订阅和桥文件随插件加载/卸载回收，避免 HMR 后出现重复 `/api/pet/*` 路由或陈旧订阅。
- **DSH `apiProxy.sessions`**：桌宠只投影 Harness 原生 session，因此工具、模型配置、工作区和审批语义保持一致。
- **Loopback HTTP + SSE**：伴生程序不需要硬编码端口。插件写入带 `instanceId` 和到期时间的桥文件，壳发现服务后用 SSE 接收流式回复和状态事件。
- **跨平台 UI 复用**：macOS 的 WKWebView 和 Windows 的 Tauri WebView2 装载同一份 `companion/Resources/pet` 页面；平台差异只留在窗口、拖动、截图和 IPC 层。
- **macOS 原生 companion**：AppKit 负责透明无边框窗口、置顶、拖动、贴边隐藏、多屏可见区域钳制和菜单栏控制；WKWebView 负责共享的输入、Markdown 渲染、历史及状态 UI；`/usr/sbin/screencapture -i` 提供一次性的用户框选截图。
- **Windows companion**：Tauri 2 负责桌面窗口和 WebView2 容器，Rust 层读取桥文件并连接同一套 loopback API；当前仍处于 Windows 实机验证阶段，能力以“平台状态”表为准。
- **视觉能力复用**：视觉链路采用开源项目 [Qwen-MM-Plugins](https://github.com/QwenLM/Qwen-MM-Plugins) 的 Qwen 多模态能力，通过 Qwen MCP 将截图转换为同一 Agent 可继续执行的视觉分析结果；它不是 DeepSeek 文本模型本身的原生视觉输入。
- **最小本地边界**：接口只监听 `127.0.0.1`，每次请求携带实例标识；视觉 API Key 只存本机 `$DSH_HOME/pet-qwen-mm.env`，不会进入仓库或上传到桌宠服务。

## 前置条件

1. 已安装并能启动 DeepSeek Harness。
2. Harness 使用 `web` profile，且系统已有 `pnpm`。下面按源码安装，适用于目前仓库开发版。
3. macOS 需要 macOS 13 或更高版本；若使用截图视觉功能，还需要在“系统设置 -> 隐私与安全性 -> 屏幕录制”中允许 DeepSeek Harness 或 companion 截取屏幕。
4. Windows 需要 Windows 10 1809 或更高版本、WebView2 Runtime、Rust stable 和 Visual Studio 2022 C++ 构建工具。
5. 先克隆本仓库：

```sh
git clone https://github.com/wjk-dot/dsh-desktop-pet.git
cd dsh-desktop-pet
```

## 安装插件

桌宠壳只负责显示和输入；必须先把 `plugin/` 接入 DSH host。`link:` 适合源码开发，修改插件后不会被 `file:` 复制的旧副本坑到。macOS 和 Windows 使用同一个 Cordis plugin，区别只在各自 companion 的安装和启动。

### macOS

```sh
cd ~/.dsh/profiles/web
pnpm add "link:/absolute/path/to/dsh-desktop-pet/plugin"
```

编辑 `~/.dsh/profiles/web/cordis.patch.yml`，确保只存在一条桌宠 loader：

```yaml
- insert:
    - id: desktop-pet
      name: '@linxin666/dsh-desktop-pet'
```

开发 checkout 位于宿主包外时，还要让 Node 找到 DSH peer dependencies：

```sh
mkdir -p "/absolute/path/to/dsh-desktop-pet/plugin/node_modules"
ln -sfn "/Applications/DeepSeek Harness.app/Contents/Resources/host/node_modules/@deepseek-ai" \
  "/absolute/path/to/dsh-desktop-pet/plugin/node_modules/@deepseek-ai"
```

重启 Harness。看到 `~/.dsh/pet-bridge.json` 后，插件 host 已经启动。

启动 macOS companion：

```sh
cd /absolute/path/to/dsh-desktop-pet/companion
swift build -c release
.build/release/DeepSeekPet
```

也可以直接打开仓库中已经构建好的 `companion/build/DeepSeekPet.app`。首次启动后，桌宠会从 `~/.dsh/pet-bridge.json` 发现 Harness；如果桥文件尚未生成，请先重启 Harness 或检查 `desktop-pet` loader 是否只配置了一次。

### Windows

在 PowerShell 中将 `<repo>` 换成仓库的绝对路径：

```powershell
cd "$env:USERPROFILE\.dsh\profiles\web"
pnpm add "link:<repo>\plugin"
```

编辑 `$env:USERPROFILE\.dsh\profiles\web\cordis.patch.yml`，加入且只加入一次：

```yaml
- insert:
    - id: desktop-pet
      name: '@linxin666/dsh-desktop-pet'
```

重启 Harness 后检查：

```powershell
Get-Content "$env:USERPROFILE\.dsh\pet-bridge.json"
```

## 启动桌宠

### macOS

```sh
cd /absolute/path/to/dsh-desktop-pet/companion
./build.sh
open build/DeepSeekPet.app
```

之后 Harness 启动时会通过桥文件自动恢复已启用的宠物。使用菜单栏的桌宠图标开关显示；网页悬浮开关已移除，避免遮挡 Harness 控件。

### Windows

Windows 当前是需要本机构建的 MVP。前置要求：Windows 10 1809+、WebView2 Runtime、Rust stable、Visual Studio 2022 Build Tools 的 **Desktop development with C++** 工作负载。

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\companions\windows\build.ps1
```

生成 release 安装器：

```powershell
.\companions\windows\build.ps1 -Release
```

产物位于 `companions/windows/src-tauri/target/release/bundle/`。CI 默认生成 NSIS `.exe`；MSI 需要本机 WiX 工具链。当前未经代码签名，仅限开发/验收，不应要求普通用户绕过 SmartScreen。

macOS companion 不依赖 Windows 的安装器流程。macOS 开发构建使用 `swift build`，应用资源和共享 Web UI 位于 `companion/Resources/`；发布时应再制作经过签名和公证的 `.app` 或 `.dmg`，当前仓库未提供已签名公证包。

如果使用 GitHub Actions 构建，必须进入运行详情确认 `Build NSIS installer` 和
`Upload installers` 都是绿色，并且页面底部出现 `DeepSeekPet-Windows` artifact。
只有看到这个 artifact，才代表 Windows 安装器真的生成了。若 Actions 里显示
`Failure` 且 `Artifacts` 为 `-`，那不是桌宠运行失败，而是安装包构建失败。

## 日常使用

1. macOS 或 Windows 都可以点击桌宠，输入任务，按 Enter 发送；macOS 也可以从菜单栏状态项显示/隐藏桌宠。
2. 到 Harness 左侧工作区打开 `桌宠对话`，可以看到同样的消息、工具调用和执行历史；也可以在这里继续任务。桌宠不会创建第二条独立会话。
3. 任务执行时，macOS 和 Windows 气泡都会显示当前工具活动；点停止按钮即可请求取消当前原生 turn。
4. 在 `设置 -> 插件 -> DeepSeek 桌宠` 调整图标和行为。配置写入 `$DSH_HOME/pet-preferences.json`，macOS 的窗口位置还会按屏幕可见区域恢复，避免桌宠完全跑到屏幕外。
5. macOS 使用截图：点截图按钮，调用系统交互式截图工具并拖拽框选区域；截图完成后先检查预览，在输入框写清楚问题，再发送。它不会后台录屏。Windows 当前不支持桌宠内的框选截图。

## 可选：Qwen 截图分析

DeepSeek 当前会话模型本身不需要原生视觉输入。该功能借助开源项目 [Qwen-MM-Plugins](https://github.com/QwenLM/Qwen-MM-Plugins)，将用户主动选取的 JPEG 交给本地 Qwen 多模态 MCP，随后让同一 DSH Agent 根据视觉结果继续工作。Qwen-MM-Plugins 负责多模态工具链，桌宠负责截图选择、凭据配置和会话投影，两者组合后仍保留 Harness 的工具调用和历史。

1. 到阿里云百炼 DashScope 控制台创建 API Key。
2. 在 Harness 的 `设置 -> 插件 -> DeepSeek 桌宠 -> Qwen 视觉凭据` 填入 Key。设置卡提供跳转链接；界面只显示末四位。
3. 安装视觉 skill。macOS 和 Windows 的 plugin 配置方式相同；桌宠内置的交互式框选目前仅 macOS 可用：

```sh
cd plugin
./install-vision.sh
```

4. 将脚本输出的 `qwen-vision.patch.yml` 条目合并到当前 profile 的 `cordis.patch.yml`，然后重启 Harness。

macOS 首次截图会请求“屏幕录制”权限；请允许实际运行截图调用的 DeepSeek Harness/companion，并在权限变更后重启应用。macOS 的截图由系统选择器完成，用户确认选区后才会写入临时 JPEG；用户仍需在输入框输入指令并主动发送，插件不会自动识别或后台录屏。Windows 桌宠内的框选截图尚未接入，请暂时从 Harness 桌面端使用视觉工作流。DashScope API Key 和临时图像都保留在本机，不要提交 `$DSH_HOME/pet-qwen-mm.env`。

## 验证与排障

```sh
cat ~/.dsh/pet-bridge.json
curl -s http://127.0.0.1:<port>/api/pet/health
```

- `duplicate exact route "/api/pet/control"`：同一 profile 装载了两个 `desktop-pet` 条目或旧插件副本。macOS 和 Windows 都必须保留一个 loader；执行 `pnpm why @linxin666/dsh-desktop-pet` 后清掉重复项，再重启 Harness。
- macOS 宠物显示离屏：macOS 版已有按当前屏幕 `visibleFrame` 的可见区域兜底，并会在恢复窗口位置时处理多屏和负坐标。先关闭并重新启动 companion；若仍异常，删除 `$DSH_HOME` 中保存的桌宠窗口位置后再启动。
- macOS 截图权限反复提示：在“系统设置 -> 隐私与安全性 -> 屏幕录制”中同时检查 DeepSeek Harness 和实际启动的 `DeepSeekPet.app`；修改权限后完全退出并重启 Harness 与 companion。若系统仍缓存旧授权，移除对应条目后重新授权。
- Windows 无法连接：先确认 `%USERPROFILE%\.dsh\pet-bridge.json` 存在且 `expiresAt` 未过期，再确认 Harness 和 Tauri companion 由同一用户启动。
- Windows 安装后看不到桌宠：先确认 Actions 下载的是成功 artifact 里的 NSIS 安装器，
  再用 PowerShell 检查：

```powershell
Get-Content "$env:USERPROFILE\.dsh\pet-bridge.json"
Get-Content "$env:USERPROFILE\.dsh\pet-desktop.json"
Get-Process DeepSeekPet -ErrorAction SilentlyContinue
Test-Path "$env:LOCALAPPDATA\DeepSeekPet\DeepSeekPet.exe"
Test-Path "$env:LOCALAPPDATA\Programs\DeepSeekPet\DeepSeekPet.exe"
Test-Path "$env:ProgramFiles\DeepSeekPet\DeepSeekPet.exe"
```

  `pet-desktop.json` 里的 `enabled` 必须为 `true`；如果进程不存在，说明 companion
  没有被启动；如果桥文件不存在，说明 DSH 插件没有在 Windows profile 中加载成功。
- 看不到桌宠消息：在工作区打开 `桌宠对话`。这是 macOS、Windows 和桌面端共用的唯一事实来源，桌宠不会维护另一份独立聊天记录。

## 开发与发布

```sh
node --check plugin/src/*.js
node --check companion/Resources/pet/pet.js
cd companion && swift build
```

macOS 开发时重点验证 `companion/Sources/PetWindow.swift` 的窗口行为、`ScreenCapture.swift` 的一次性框选截图和 `HostClient.swift` 的桥文件/SSE 连接；Windows 开发时在 Windows 实机运行对应 Tauri 构建脚本。两端都应使用同一份 `companion/Resources/pet` Web UI，并通过 `plugin/` 的 loopback API 验证会话、历史和任务状态。

Windows GitHub Actions 工作流位于 [`.github/workflows/windows-companion.yml`](.github/workflows/windows-companion.yml)。手动触发它，或推送 `windows-v*` tag，CI 会在 Windows runner 构建 MSI 和 NSIS artifact。发布前仍要做 Windows 实机验证和 Authenticode 签名。

macOS 发布前还应在目标 macOS 版本验证透明窗口、菜单栏开关、窗口拖动/贴边、屏幕录制授权、系统粘贴/复制和多显示器位置恢复，并对 `.app` 做 Developer ID 签名与 notarization。当前仓库的 macOS 构建适合开发和本机使用，不能等同于已签名发行包。

详细跨平台计划见 [docs/plans/2026-08-17-cross-platform-release.md](docs/plans/2026-08-17-cross-platform-release.md)，插件专用说明见 [plugin/README.md](plugin/README.md)。

## License

Apache-2.0。视觉识别链路使用 [Qwen-MM-Plugins](https://github.com/QwenLM/Qwen-MM-Plugins)，其代码和依赖许可请以该项目仓库为准。
