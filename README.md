# DeepSeek 桌宠

> 让 DeepSeek Harness 的 Agent 住到你的桌面上。
>
> 点击桌宠就能发起对话；在 Harness 里打开 `桌宠对话`，又能继续刚才的上下文。它不是另一个独立的聊天机器人，而是 DeepSeek Harness 同一条 Agent 会话的一个轻量入口：模型、工具、任务状态、历史记录和取消操作，都与 Harness 保持一致。

## 先看这里：平台说明

本 README 同时介绍 macOS 和 Windows 版本。macOS 版本使用 Swift/AppKit + WKWebView，当前已在本机验证；Windows 版本使用 Tauri 2 + WebView2，当前处于持续完善和实机验证阶段。

Windows 版目前处于持续完善阶段。桌宠的核心对话链路已经接入 Harness，但窗口贴边、拖拽、隐藏恢复、多显示器和截图识别等体验仍在不断打磨。不同 Windows 版本、缩放比例、屏幕数量和 WebView2 环境可能表现不同；如果你遇到桌宠跑到屏幕边缘、无法拖回、窗口重复或截图配置未识别，请先查看本文末尾的“常见问题”和“反馈信息”。

它适合愿意尝试 Windows 预览版的 Harness 用户，也欢迎你把实际体验反馈回来；暂时不建议把它当作已经完成所有边界场景验证的正式商业发行版。

macOS 版本的透明悬浮窗口、拖动、菜单栏显示/隐藏、贴边隐藏、历史同步、任务状态、取消任务、系统粘贴/复制和用户框选截图已经可用。macOS 当前仍是开发版 companion，尚未提供经过 Developer ID 签名和 notarization 的正式安装包。

## 它能做什么

- **桌面悬浮对话**：macOS 和 Windows 都会显示轻量、透明、无边框的 DeepSeek 桌宠。点击它，输入问题，即可直接和 Harness 中的 Agent 对话。
- **共享同一条会话**：桌宠与 Harness 工作区中的 `桌宠对话` 使用同一个原生 Agent session。你可以在桌宠上问到一半，切回 Harness 继续；也可以先在 Harness 里布置任务，再从桌宠观察进度。
- **流式回复**：回复会像正常对话一样逐步出现，长任务不必等到全部完成才看到结果。
- **任务状态提示**：Agent 调用工具或执行任务时，桌宠可以显示当前活动；需要时可以从桌宠取消任务。
- **历史与富文本**：支持 Markdown、代码、表格、公式等内容，已产生的对话也会回到同一会话历史中。
- **拖动与大小调节**：macOS 和 Windows 都可以移动桌宠位置，并在插件配置中调整图标大小；macOS 还会按屏幕可见区域恢复位置，避免窗口完全跑到屏幕外。
- **显示偏好**：可以选择是否显示任务状态、减少动画、自动贴边隐藏，以及是否启用截图分析入口。macOS 的贴边隐藏和菜单栏开关由 AppKit 原生窗口控制。
- **可选视觉能力**：配置 Qwen 多模态 MCP 后，可以从桌宠发起截图分析。macOS 支持系统交互式框选截图；Windows 当前仍属于实验性能力，建议从 Harness 桌面端使用视觉工作流。

## 工作方式：为什么需要两个部分

DeepSeek 桌宠是一个完整插件项目，由一个 Harness 插件和按平台提供的 companion 共同组成：

```text
DeepSeek Harness
    |
    | 1. 插件：负责会话、配置、任务状态和本机桥接
    v
桌宠插件 @linxin666/dsh-desktop-pet
    |
    | 2. 平台伴生程序：负责桌面上的透明窗口和交互
    v
macOS: DeepSeekPet.app
Windows: DeepSeekPet.exe
```

只安装 Harness 插件，桌面上不一定会自动出现窗口；只运行 companion，它也无法独立替代 Harness 完成对话。两者通过当前用户目录下的本机桥文件通信：

macOS：`~/.dsh/pet-bridge.json`
Windows：`%USERPROFILE%\.dsh\pet-bridge.json`

macOS companion 使用 Swift/AppKit + WKWebView；Windows companion 使用 Rust/Tauri 2 + WebView2。两端都通过 `127.0.0.1` 回环地址连接同一个插件服务，桌宠不是一个额外的云端聊天服务，也不会因此创建第二套独立会话。

视觉识别链路采用开源项目 [Qwen-MM-Plugins](https://github.com/QwenLM/Qwen-MM-Plugins)：Qwen MCP 负责多模态图片理解，桌宠负责用户截图、凭据配置和结果展示，最终结果仍回到 Harness 的同一条 `桌宠对话` 会话。

## 安装前准备

### 必备条件

1. macOS 需要 macOS 13 或更高版本；Windows 需要 Windows 10 1809 或更高版本，推荐使用最新更新版本。
2. 已安装并能正常打开 DeepSeek Harness。
3. Harness 已完成自己的模型、网络和工作区配置。桌宠沿用 Harness 当前的 Agent 配置，不在桌宠里另建一套模型账号。
4. Windows 需要 Microsoft Edge WebView2 Runtime。大多数 Windows 10/11 电脑已经自带；如果桌宠启动后窗口空白或无法渲染，需要到微软官方渠道安装或修复 WebView2 Runtime。
5. macOS 使用截图视觉功能时，需要在“系统设置 -> 隐私与安全性 -> 屏幕录制”中允许实际运行截图的 DeepSeek Harness 或 `DeepSeekPet.app`。

### 如果你准备从源码安装

Windows 源码安装只适合开发者或愿意参与 Windows 实机测试的用户，还需要：

- Node.js 22 或更高版本；
- `pnpm`；
- Rust stable 与 Cargo；
- Visual Studio 2022 Build Tools 的 **Desktop development with C++** 工作负载；
- Windows SDK；
- 能访问 GitHub 和 npm/crates.io 的网络环境。

普通用户优先使用插件市场中的插件包，以及项目 Releases 或 Actions 提供的 Windows 伴生程序安装包，不需要先安装 Rust 和 Visual Studio。

macOS 源码构建需要 Xcode Command Line Tools 或完整 Xcode，以及 Swift 工具链。构建前可执行：

```sh
xcode-select --install
```

macOS 当前没有公开签名安装器；本机开发可直接使用仓库中的 `companion/` Swift package 和已构建的 `companion/build/DeepSeekPet.app`。

## 安装方式一：通过 Harness 插件市场安装

这是面向普通用户的推荐方式。macOS 和 Windows 都需要安装 Harness 插件；Windows 还需要单独安装 Windows companion，macOS 则使用 Swift companion。

### 第一步：安装插件

1. 打开 DeepSeek Harness。
2. 进入 **设置**，打开 **插件** 或 **插件市场** 页面。
3. 搜索 `DeepSeek 桌宠`。如果市场支持按包名搜索，也可以搜索 `@linxin666/dsh-desktop-pet`。
4. 打开插件详情，确认发布者和插件名称无误后，点击安装。
5. 安装完成后，将插件切换为启用状态；如果 Harness 提示重启，请完全退出并重新打开 Harness。

### 第二步：安装 Windows 桌宠伴生程序

插件负责连接 Harness，Windows 伴生程序负责真正显示桌面窗口。请根据项目当前提供的发布形式选择其一：

- 如果插件详情页或项目 Releases 提供了 Windows 安装器，下载 Windows 版本并运行安装器。安装完成后，通常会放在当前用户的本地应用目录中。
- 如果当前还没有公开 Release 安装器，请进入本仓库 GitHub 的 **Actions** 页面，下载成功运行产生的 `DeepSeekPet-Windows` artifact。解压后运行其中的 NSIS 安装器，再重新启动 Harness。
- 如果你拿到的是开发者提供的 `DeepSeekPet.exe`，请将它安装或放置到插件能够自动查找的常见位置，例如：

```text
%LOCALAPPDATA%\DeepSeekPet\DeepSeekPet.exe
%LOCALAPPDATA%\Programs\DeepSeekPet\DeepSeekPet.exe
%ProgramFiles%\DeepSeekPet\DeepSeekPet.exe
```

当前仓库可能只有 CI 构建产物而没有已签名的公开安装器。Windows 对未签名程序显示 SmartScreen 警告时，请先确认文件来自本项目的 GitHub 仓库或可信发布者；不要为了运行来源不明的文件而关闭系统安全防护。

### 第三步：确认 Harness 已加载插件

重新打开 Harness 后，进入：

**设置 -> 插件 -> 插件配置 -> DeepSeek 桌宠**

能看到 **DeepSeek 桌宠** 配置卡片，说明插件已经被 Harness 加载。此时桌宠伴生程序会根据“启用桌宠”状态自动显示或保持隐藏。

### macOS companion

macOS 当前没有公开签名安装器。完成插件安装后，在仓库目录执行：

```sh
cd /absolute/path/to/dsh-desktop-pet/companion
swift build -c release
.build/release/DeepSeekPet
```

也可以直接打开 `companion/build/DeepSeekPet.app`。首次启动时，AppKit companion 会读取 `~/.dsh/pet-bridge.json`，发现当前 Harness 的本机服务后显示桌宠。若桥文件尚未出现，请先重启 Harness，或检查当前 profile 中是否只配置了一条 `desktop-pet` loader。

## 安装方式二：从 GitHub 源码安装

这是给开发者、贡献者和需要测试最新提交的 macOS/Windows 用户准备的方式。

### 1. 获取项目

在 PowerShell 中执行：

```powershell
git clone https://github.com/wjk-dot/dsh-desktop-pet.git
cd dsh-desktop-pet
```

### 2. 将插件链接到 Harness 的 web profile

将 <项目目录> 替换为仓库所在的绝对路径：

macOS：

```sh
cd ~/.dsh/profiles/web
pnpm add "link:/absolute/path/to/dsh-desktop-pet/plugin"
```

Windows：

```powershell
cd "$env:USERPROFILE\.dsh\profiles\web"
pnpm add "link:<项目目录>\plugin"
```

然后打开：

`%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`

确认其中存在且只存在一条桌宠 loader：

```yaml
- insert:
    - id: desktop-pet
      name: '@linxin666/dsh-desktop-pet'
```

如果同一个 profile 中重复插入了两次 `desktop-pet`，Harness 可能出现重复路由、两个桌宠或插件配置状态异常。修改后完全退出 Harness，再重新打开。

macOS 开发 checkout 位于 Harness 应用包外时，如果 Node 无法解析 DSH peer dependencies，可执行：

```sh
mkdir -p "/absolute/path/to/dsh-desktop-pet/plugin/node_modules"
ln -sfn "/Applications/DeepSeek Harness.app/Contents/Resources/host/node_modules/@deepseek-ai" \
  "/absolute/path/to/dsh-desktop-pet/plugin/node_modules/@deepseek-ai"
```

### 3. 构建 Windows 伴生程序

在仓库根目录执行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\companions\windows\build.ps1 -Release
```

构建成功后，安装器或可执行文件位于：

`companions\windows\src-tauri\target\release\bundle\`

开发调试时也可以运行：

```powershell
.\companions\windows\build.ps1
```

插件会尝试自动查找已安装的 `DeepSeekPet.exe`；在源码 checkout 中，也会查找：

`companions\windows\src-tauri\target\release\deepseek-pet-windows.exe`

构建 macOS companion：

```sh
cd companion
swift build -c release
./.build/release/DeepSeekPet
```

macOS 应用资源和共享桌宠 Web UI 位于 `companion/Resources/`；当前仓库的 macOS 构建适合开发和本机使用，尚未制作 Developer ID 签名与 notarization 的正式 `.app`/`.dmg`。

## 第一次启动

### Windows

完成插件和 Windows companion 安装后，按下面顺序启动：

1. 完全退出已经打开的 DeepSeek Harness。任务栏、托盘和后台进程中如果仍有 Harness，也一并退出。
2. 启动 Harness，等待主界面加载完成。
3. 打开 **设置 -> 插件 -> 插件配置 -> DeepSeek 桌宠**。
4. 打开 **启用桌宠**。
5. 等待几秒，桌面上应出现透明的桌宠窗口。
6. 点击桌宠，输入一句简单的问题，例如“请介绍一下你能做什么”，按 Enter 发送。

首次启动时，桌宠可能需要等待 Harness 写入本机桥文件并启动伴生程序。可以用下面的 PowerShell 命令检查桥文件是否出现：

```powershell
Get-Content "$env:USERPROFILE\.dsh\pet-bridge.json"
```

如果你希望 Harness 启动时桌宠也同步启动，请保持 **启用桌宠** 为开启状态后正常关闭 Harness。下次启动 Harness 时，插件会读取上次保存的状态：上次开启则自动显示，上次关闭则继续保持关闭。这是持久化开关，不是每次启动都强制打开。

### macOS

1. 完全退出已经打开的 DeepSeek Harness 和 `DeepSeekPet` companion。
2. 启动 Harness，等待主界面加载完成并确认 `~/.dsh/pet-bridge.json` 存在。
3. 启动 `.build/release/DeepSeekPet` 或打开 `companion/build/DeepSeekPet.app`。
4. 在 Harness 的 **设置 -> 插件 -> 插件配置 -> DeepSeek 桌宠** 中打开 **启用桌宠**。
5. 桌宠出现后点击主体，输入“请介绍一下你能做什么”，按 Enter 发送。

macOS companion 还会在菜单栏显示 DeepSeek 桌宠菜单，可用于显示/隐藏桌宠、刷新桌宠会话和退出 companion。若窗口位置历史异常，macOS 版本会按当前屏幕的可见区域进行兜底恢复。

## 日常使用

### 与桌宠聊天

1. 单击桌宠主体，打开对话输入区域。
2. 输入问题；macOS 使用 Command-V，Windows 使用 Ctrl-V，都可以粘贴文字、代码或路径。
3. 按 Enter 发送。
4. 回复会以流式方式显示在桌宠附近。
5. 点击 Harness 工作区中的 `桌宠对话`，可以查看并继续同一条会话。

桌宠不是另一个“分身 Agent”。从桌宠发出的消息会进入 Harness 的同一个会话，因此在 Harness 里可以继续使用工作区上下文、工具和已有历史。

### 拖动桌宠

按住桌宠可拖动到桌面其他位置。建议第一次使用时先把桌宠放在主屏幕中间，确认窗口可以正常点击、输入和移动，再尝试把它放到屏幕边缘或扩展屏。

macOS 版支持左、右、下边缘贴靠和自动隐藏，并在多显示器、负坐标屏幕场景下将窗口限制在可见区域；Windows 版的边缘贴靠、自动隐藏和多显示器位置恢复仍在优化中。若 Windows 桌宠被放到屏幕边框后难以拖回，先关闭插件中的 **自动贴边隐藏**，再重新启动 Harness 和桌宠。

### 查看任务状态与取消任务

在插件设置中开启 **显示任务状态** 后，Agent 执行工具或长任务运行时，桌宠附近会显示活动状态。需要停止时，可以使用桌宠上的取消操作；也可以直接在 Harness 中停止当前任务。

### 调整外观和交互

在 **设置 -> 插件 -> 插件配置 -> DeepSeek 桌宠** 中可以调整：

| 设置项 | 用途 |
| --- | --- |
| 启用桌宠 | 显示或隐藏 macOS/Windows 桌宠窗口，不会删除 `桌宠对话` 会话。macOS 也可从菜单栏切换。 |
| 图标尺寸 | 调整桌宠的显示大小，适合不同分辨率和缩放比例的屏幕。 |
| 显示任务状态 | 显示工具调用和 Agent 执行状态，并提供取消任务入口。 |
| 减少动画 | 降低漂浮、呼吸和过渡动画，适合专注工作或低干扰场景。 |
| 自动贴边隐藏 | macOS 支持边缘贴靠和收起；Windows 版仍在持续完善。 |
| 启用截图分析 | 显示或隐藏截图分析入口；使用前还需要完成 Qwen 视觉环境配置。macOS 支持桌宠内交互式框选，Windows 当前建议从 Harness 使用。 |


## 可选：配置截图分析与 Qwen 视觉

截图分析不是桌宠后台录屏。只有在你主动点击截图功能并选择区域后，选中的图像才会被提交给视觉工作流。视觉结果会回到当前的 `桌宠对话` 会话中。

本项目的视觉工具链采用开源项目 [Qwen-MM-Plugins](https://github.com/QwenLM/Qwen-MM-Plugins)。它通过 Qwen 多模态 MCP 提供 OCR、界面理解和图片问答能力；桌宠只负责用户主动截图、配置 DashScope API Key、把图片和问题提交到同一 Agent session。DeepSeek 当前使用的文本模型本身不提供原生图片输入，因此 Qwen 视觉结果会先作为工具结果回到 Harness，再由 Agent 继续分析或执行任务。

### 准备视觉环境

Windows 用户通常需要准备：

- 阿里云百炼 DashScope API Key；
- `uvx` 命令可用；
- Qwen 多模态 MCP 所需的 Python 环境和网络访问；
- Harness 当前 profile 中加载 Qwen MCP 配置。

macOS 用户使用桌宠内置截图还需要：

- 在“系统设置 -> 隐私与安全性 -> 屏幕录制”中允许实际运行截图的 DeepSeek Harness 或 `DeepSeekPet.app`；
- 使用桌宠截图按钮打开 macOS 系统交互式选择器，用户拖拽选区并确认后才会生成 JPEG；
- 截图完成后在对话框输入问题，再主动按 Enter 发送，插件不会自动识别截图。

在 Harness 中进入：

**设置 -> 插件 -> 插件配置 -> DeepSeek 桌宠 -> Qwen 视觉凭据**

填入 DashScope API Key，可选填视觉模型名称，然后点击 **保存 Qwen 凭据**。密钥只写入本机的 DSH 配置目录，不要把它提交到 GitHub，也不要把它粘贴到公开 issue。

如果你是源码安装用户，可以在仓库中查看视觉配置模板：

```text
plugin\qwen-vision.patch.yml
plugin\install-vision.sh
```

将 Qwen MCP 条目合并到当前 Windows profile 的 `cordis.patch.yml` 后，完全重启 Harness。仅填写 API Key 而没有加载 MCP，截图分析仍然可能显示“未配置”。

### 当前 Windows 预览版提示

Windows 截图、WebView2 焦点、MCP 进程环境和多屏缩放之间存在较多系统差异。即使 API Key 已保存，插件配置卡片也可能暂时无法正确识别视觉环境；请把它视为实验性功能，不要把截图分析作为当前 Windows 版的唯一工作流。

macOS 版本的框选截图调用 `/usr/sbin/screencapture -i`，不会在后台录屏或定时截图。首次使用时系统可能弹出屏幕录制权限提示；修改权限后应完全退出并重启 Harness 与 `DeepSeekPet.app`。API Key 和临时图片只保留在本机，不要提交 `$DSH_HOME/pet-qwen-mm.env`。

## 常见问题

### 插件已经显示“开启”，但桌宠没有出现

插件开关和桌面窗口是两个环节。按顺序检查：

1. 确认 **设置 -> 插件 -> 插件配置 -> DeepSeek 桌宠** 中的 **启用桌宠** 已打开。
2. 确认 Windows 进程存在：

```powershell
Get-Process DeepSeekPet -ErrorAction SilentlyContinue
```

3. 确认插件桥文件存在且没有过期：

```powershell
Get-Content "$env:USERPROFILE\.dsh\pet-bridge.json"
```

4. 确认桌宠伴生程序安装在插件可查找的位置：

```powershell
Test-Path "$env:LOCALAPPDATA\DeepSeekPet\DeepSeekPet.exe"
Test-Path "$env:LOCALAPPDATA\Programs\DeepSeekPet\DeepSeekPet.exe"
Test-Path "$env:ProgramFiles\DeepSeekPet\DeepSeekPet.exe"
```

5. 完全退出 Harness 和 `DeepSeekPet` 后，只重新启动一次 Harness。不要同时手动启动多个桌宠进程。

macOS 对应检查：确认 `~/.dsh/pet-bridge.json` 存在，然后启动 `companion/build/DeepSeekPet.app` 或 `.build/release/DeepSeekPet`。如果 macOS 桌宠已经运行但窗口不可见，先关闭 companion 再重新启动；`PetWindow.swift` 会将保存位置钳制到当前屏幕可见区域。

### 为什么会出现两个桌宠

通常是重复加载了插件，或手动启动了一个桌宠后 Harness 又按开关自动启动了另一个实例。检查 `cordis.patch.yml` 中是否有多个 `desktop-pet` 条目；同时关闭多余的 `DeepSeekPet` 进程，再重新启动 Harness。

### 桌宠被推到边缘后无法拖回来

这是当前 Windows 版仍在修复的已知问题，尤其容易出现在扩展屏、混合 DPI 缩放和自动贴边开启时。先在插件配置中关闭 **自动贴边隐藏**，然后重新启动 Harness。不要反复点击屏幕边缘寻找不可见窗口；如果仍无法恢复，请记录屏幕排列、缩放比例和 Harness 版本并反馈。

macOS 版本支持左、右、下边缘贴靠；如果需要完整显示窗口，可关闭 **自动贴边隐藏**，或将桌宠拖离屏幕边缘。多屏和负坐标场景由 companion 的可见区域兜底处理。

### 桌宠可以显示，但点击没有反应或一碰就躲开

先确认桌宠窗口没有被另一个旧实例覆盖，再关闭并重新启动 Harness。也可以暂时关闭 **自动贴边隐藏** 和动画相关设置，排除窗口命中区域或贴边状态的影响。若问题反复出现，请附上 Windows 版本、主屏/扩展屏数量、缩放比例和复现步骤。

### 上滑查看历史时，内容突然回到底部

这是当前 Windows 桌宠对话气泡的已知体验问题。需要稳定查看完整历史时，建议暂时在 Harness 的 `桌宠对话` 页面中阅读；桌宠与该会话共享消息，不会丢失历史。

### 截图配置好了，为什么仍显示“未配置”

截图分析依赖三项同时成立：桌宠设置已启用、DashScope API Key 已保存、Qwen MCP 已被当前 Harness profile 加载。请确认修改的是正在运行的 profile，并在合并 `cordis.patch.yml` 后完全重启 Harness。Windows GUI 启动时的 PATH 可能与 PowerShell 不同，导致 `uvx` 找不到；可以先在 PowerShell 执行：

```powershell
Get-Command uvx
uvx --version
```

如果命令存在但 Harness 仍显示未配置，请保留配置卡片状态、Harness 日志和当前 profile 信息，提交 issue 时一并提供。

macOS 还要确认 API Key 保存到当前用户的 `~/.dsh`，Qwen MCP 条目已合并到当前 `web` profile，并且屏幕录制权限授予了实际启动截图的应用。修改权限或配置后，完全重启 Harness 和 companion。

### 如何确认当前插件只加载了一份

在 Harness 所使用的 profile 目录中检查 `cordis.patch.yml`，确认只出现一次 `id: desktop-pet`。然后执行：

```powershell
pnpm why @linxin666/dsh-desktop-pet
```

如果同时存在市场安装包、`link:` 开发副本和旧的 `file:` 副本，可能会造成路由或桌宠实例重复。保留一种安装来源即可。

## 完全卸载

1. 在桌宠配置中关闭 **启用桌宠**。
2. 完全退出 DeepSeek Harness。
3. 在 Harness 的插件管理页卸载 `DeepSeek 桌宠`。
4. Windows 在“应用和功能”中卸载 `DeepSeekPet` 伴生程序；macOS 退出 `DeepSeekPet.app` 并移除该应用或 Swift 构建产物。
5. 如需清理桌宠个人设置，可在确认不再需要后删除以下文件：

```text
macOS: ~/.dsh/pet-desktop.json
macOS: ~/.dsh/pet-preferences.json
macOS: ~/.dsh/pet-bridge.json
%USERPROFILE%\.dsh\pet-desktop.json
%USERPROFILE%\.dsh\pet-preferences.json
%USERPROFILE%\.dsh\pet-bridge.json
```

不要为了卸载桌宠直接删除整个 `%USERPROFILE%\.dsh` 目录，否则可能一并删除 Harness 的其他 profile、会话和用户配置。


## 反馈 Windows 问题

Windows 版正在快速迭代，反馈越具体，越容易定位到窗口、桥接、WebView2 还是视觉环境。提交 issue 时请尽量包含：

- Windows 版本和系统版本号；
- DeepSeek Harness 版本；
- 桌宠插件安装来源（插件市场、Release、Actions artifact 或源码）；
- 主屏与扩展屏数量、排列方式、每块屏幕的缩放比例；
- 问题发生前做了什么，以及可以稳定复现的步骤；
- `Get-Content "$env:USERPROFILE\.dsh\pet-bridge.json"` 的结果，提交前请删除端口以外的敏感信息；
- 是否同时安装过多个版本、是否手动启动过 `DeepSeekPet.exe`；
- 截图功能问题还应附上 `Get-Command uvx` 和 `uvx --version` 的结果。

项目地址：[wjk-dot/dsh-desktop-pet](https://github.com/wjk-dot/dsh-desktop-pet)

## 反馈 macOS 问题

反馈 macOS 的窗口、截图或粘贴问题时，请尽量包含：

- macOS 版本、DeepSeek Harness 版本和 companion 启动方式（`.app` 或 Swift 构建）；
- 主屏与扩展屏数量、排列方式和缩放设置；
- 是否授予 DeepSeek Harness/`DeepSeekPet.app` 屏幕录制权限；
- 问题发生前做了什么，以及可以稳定复现的步骤；
- `~/.dsh/pet-bridge.json` 中的端口、实例和过期时间等信息，提交前删除敏感字段；
- 是否同时运行了多个 companion 或安装过多个插件副本。

## 开发者入口

项目目录大致如下：

- `plugin/`：DeepSeek Harness Cordis 插件
- `companion/Resources/pet/`：桌宠共享 Web 界面
- `companion/Sources/`：macOS Swift/AppKit + WKWebView companion
- `companions/windows/`：Windows Tauri 伴生程序
- `.github/workflows/`：Windows CI 构建流程

Windows CI 工作流支持手动运行，并会在成功后上传 `DeepSeekPet-Windows` artifact。公开发布前仍需要 Windows 实机验证、安装器测试和代码签名。macOS 开发构建使用 `cd companion && swift build`；发布 macOS `.app` 前还应完成 Developer ID 签名和 notarization。开发者专用的 Windows 构建说明见 [companions/windows/README.md](companions/windows/README.md)。

## 许可证

Apache-2.0，详见 [LICENSE](LICENSE)。视觉识别链路使用 [Qwen-MM-Plugins](https://github.com/QwenLM/Qwen-MM-Plugins)，其代码和依赖许可请以该项目仓库为准。
