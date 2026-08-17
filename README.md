# DeepSeek Harness Desktop Pet

> 一个连接到 DeepSeek Harness 原生 Agent 的桌面宠物。它不是第二个聊天机器人：桌宠和 Harness 工作区里的 `桌宠对话` 是同一条完整 Agent 执行链，可在任一端继续对话、使用工具、查看历史或取消任务。

## 它能做什么

- 常驻桌面：透明、无边框、置顶的 DeepSeek 图标；点击弹出输入框和对话气泡。
- 同一条 Agent 会话：桌宠、Harness 左侧工作区的 `桌宠对话`、工具调用、任务状态与取消共用同一个 DSH native session，不复制或分叉上下文。
- 双端任务投影：无论任务从桌宠还是完整 Harness 发起，宠物都会显示思考/工具状态；长任务可从宠物取消。
- 富文本气泡：支持 Markdown、代码高亮、表格和 KaTeX 公式；输入框支持系统粘贴，气泡内容可复制。
- 插件配置：在 Harness 的 `设置 -> 插件 -> DeepSeek 桌宠` 调整启用状态、图标大小、任务状态、动画、贴边和视觉功能。
- 可选 Qwen 视觉：在 macOS 上可由用户主动框选截图，输入问题后交给本机配置的 Qwen 多模态 MCP 分析；分析过程和结论回到同一 Agent 会话。

## 平台状态

| 平台 | 桌宠壳 | 可用能力 | 状态 |
| --- | --- | --- | --- |
| macOS 13+ | Swift + AppKit + WKWebView | 悬浮、拖动、菜单栏开关、历史、任务状态、取消、用户框选截图 | 已可用 |
| Windows 10 1809+ | Tauri 2 + WebView2 | 悬浮、拖动、聊天 SSE、历史、任务状态、取消、粘贴/复制 | 源码 MVP，需在 Windows 构建验证 |
| Linux | 未提供 | 插件的 `桌宠对话` session 仍可在 Harness 中使用 | 未开始 |

Windows 目前没有发布已签名的安装包。仓库已经包含 MSI/NSIS 的 CI 构建配置，但系统托盘、框选截图、多屏位置恢复和代码签名尚未完成，别把它吹成完整发行版。

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
- **最小本地边界**：接口只监听 `127.0.0.1`，每次请求携带实例标识；视觉 API Key 只存本机 `$DSH_HOME/pet-qwen-mm.env`，不会进入仓库或上传到桌宠服务。

## 前置条件

1. 已安装并能启动 DeepSeek Harness。
2. Harness 使用 `web` profile，且系统已有 `pnpm`。下面按源码安装，适用于目前仓库开发版。
3. 先克隆本仓库：

```sh
git clone https://github.com/wjk-dot/dsh-desktop-pet.git
cd dsh-desktop-pet
```

## 安装插件

桌宠壳只负责显示和输入；必须先把 `plugin/` 接入 DSH host。`link:` 适合源码开发，修改插件后不会被 `file:` 复制的旧副本坑到。

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

如果使用 GitHub Actions 构建，必须进入运行详情确认 `Build NSIS installer` 和
`Upload installers` 都是绿色，并且页面底部出现 `DeepSeekPet-Windows` artifact。
只有看到这个 artifact，才代表 Windows 安装器真的生成了。若 Actions 里显示
`Failure` 且 `Artifacts` 为 `-`，那不是桌宠运行失败，而是安装包构建失败。

## 日常使用

1. 点击宠物，输入任务，按 Enter 发送。
2. 到 Harness 左侧工作区打开 `桌宠对话`，可以看到同样的消息、工具调用和执行历史；也可以在这里继续任务。
3. 任务执行时，气泡会显示当前工具活动；点停止按钮即可请求取消当前原生 turn。
4. 在 `设置 -> 插件 -> DeepSeek 桌宠` 调整图标和行为。配置写入 `$DSH_HOME/pet-preferences.json`。
5. macOS 使用截图：点截图按钮，拖拽框选区域，完成截图后在输入框写清楚问题，再发送。它不会后台录屏。

## 可选：Qwen 截图分析

DeepSeek 当前会话模型本身不需要原生视觉输入。该功能将用户主动选取的 JPEG 交给本地 Qwen 多模态 MCP，随后让同一 DSH Agent 根据视觉结果继续工作。

1. 到阿里云百炼 DashScope 控制台创建 API Key。
2. 在 Harness 的 `设置 -> 插件 -> DeepSeek 桌宠 -> Qwen 视觉凭据` 填入 Key。设置卡提供跳转链接；界面只显示末四位。
3. 安装视觉 skill：

```sh
cd plugin
./install-vision.sh
```

4. 将脚本输出的 `qwen-vision.patch.yml` 条目合并到当前 profile 的 `cordis.patch.yml`，然后重启 Harness。

macOS 首次截图会请求“屏幕录制”权限。Windows 框选截图尚未接入，因此请暂时从 Harness 桌面端使用视觉工作流。API Key 和临时图像都保留在本机，不要提交 `$DSH_HOME/pet-qwen-mm.env`。

## 验证与排障

```sh
cat ~/.dsh/pet-bridge.json
curl -s http://127.0.0.1:<port>/api/pet/health
```

- `duplicate exact route "/api/pet/control"`：同一 profile 装载了两个 `desktop-pet` 条目或旧插件副本。保留一个 loader，执行 `pnpm why @linxin666/dsh-desktop-pet` 后清掉重复项，再重启 Harness。
- 宠物显示离屏：macOS 版已有可见区域兜底。先关闭并重新启动 companion；若仍异常，删除 `$DSH_HOME` 中保存的桌宠窗口位置后再启动。
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
- 看不到桌宠消息：在工作区打开 `桌宠对话`。这是唯一事实来源，桌宠不会维护另一份独立聊天记录。

## 开发与发布

```sh
node --check plugin/src/*.js
node --check companion/Resources/pet/pet.js
cd companion && swift build
```

Windows GitHub Actions 工作流位于 [`.github/workflows/windows-companion.yml`](.github/workflows/windows-companion.yml)。手动触发它，或推送 `windows-v*` tag，CI 会在 Windows runner 构建 MSI 和 NSIS artifact。发布前仍要做 Windows 实机验证和 Authenticode 签名。

详细跨平台计划见 [docs/plans/2026-08-17-cross-platform-release.md](docs/plans/2026-08-17-cross-platform-release.md)，插件专用说明见 [plugin/README.md](plugin/README.md)。

## License

Apache-2.0
