# DeepSeek 桌宠 Windows 端修复任务

> 这是交接给 Windows 端 Codex 的独立任务书。请按本文件完成修复、构建和实机验证，不要只停留在代码层面。

## 1. 任务背景

仓库地址：`https://github.com/wjk-dot/dsh-desktop-pet`

当前 Mac 端最新提交为：

```text
e3b608a fix: make Windows bridge event emit payload cloneable
```

Windows 版桌宠已经可以通过 Tauri 2 原生窗口运行，但实机出现三个问题：

1. 桌宠被一个明显的大透明矩形框包住，视觉上像窗口被一个矩形透明容器圈起来。
2. 这个透明矩形区域会遮挡 DeepSeek Harness 的侧边栏隐藏按钮，导致按钮无法点击。
3. 桌宠输入栏里的截图按钮不可用，点击后只会提示“Windows 截图选择器开发中”。

本任务需要把这三个问题全部修到可交付状态，并保持现有 macOS 端功能不回退。

## 2. 必读代码

开始实现前，先完整阅读以下文件：

```text
companions/windows/src-tauri/tauri.conf.json
companions/windows/src-tauri/src/main.rs
companions/windows/src-tauri/Cargo.toml
companions/windows/build.ps1
companion/Resources/pet/index.html
companion/Resources/pet/pet.css
companion/Resources/pet/pet.js
```

macOS 端已有可参考的完整实现：

```text
companion/Sources/ScreenCapture.swift
companion/Sources/HostClient.swift
companion/Sources/PetWebView.swift
companion/Sources/PetWindow.swift
```

重点理解 macOS 的截图流程和桥接协议，Windows 端要做出等价行为，而不是复制 Swift 代码。

## 3. 根因分析

### 3.1 大透明矩形框

`tauri.conf.json` 当前配置为：

```json
{
  "width": 380,
  "height": 560,
  "decorations": false,
  "transparent": true,
  "alwaysOnTop": true,
  "skipTaskbar": true,
  "resizable": false,
  "visible": true
}
```

前端 `pet.js` 的 `applyLayout()` 在气泡、输入框或任务进行时会把窗口设成：

```js
w = 380
h = iconSize + 406
```

因此用户看到的大矩形不是渲染异常，而是 Tauri 原生窗口的真实客户区尺寸。

`transparent: true` 只影响 WebView2 的绘制透明度，不会让 Windows 原生窗口变成不规则窗口，也不会让空白区域自动穿透鼠标事件。即使网页背景完全透明，窗口仍是一个矩形顶层窗口，并且 `alwaysOnTop: true` 会让它覆盖在 DeepSeek Harness 上方。

### 3.2 侧边栏隐藏按钮被遮挡

这是大透明框的直接后果：

- 透明区域仍然会接收鼠标事件；
- 桌宠窗口覆盖到 Harness 侧边栏隐藏按钮时，按钮无法点击；
- 不能简单地把整窗设为 `set_ignore_cursor_events(true)`，否则桌宠图标、气泡和输入框也会失去点击能力。

### 3.3 截图不可用

Windows Rust 端目前只是占位实现，没有接入任何截图能力：

```rust
PetMessage::Vision { prompt } => {
    emit(&app, "renderError", vec![json!("Windows 截图选择器尚未接入；请先在桌面端使用截图分析。")]);
    let _ = prompt;
}

PetMessage::Capture => {
    emit(&app, "captureFailed", vec![json!("Windows 截图选择器开发中")]);
}
```

## 4. 桥接协议（不要改坏）

前端点击截图按钮：

```js
post('capture')
```

原生截图成功后必须调用：

```js
window.petBridge.captureReady()
```

原生截图取消或失败时调用：

```js
window.petBridge.captureFailed(message)
```

用户选择截图后，前端不会立即提交识别。输入框会打开，等用户输入问题并发送时，前端调用：

```js
post('vision', { prompt: text })
```

Rust 端收到 `Vision` 后，需要向 host 发起：

```text
POST /api/pet/vision
```

请求体格式：

```json
{
  "data": "<base64 jpeg>",
  "name": "selected-screenshot.jpg",
  "prompt": "<用户输入的问题>"
}
```

响应流与 `/api/pet/chat` 相同，需要解析 SSE：

```text
data: {"type":"delta","text":"..."}
data: {"type":"activity","activity":{...}}
data: {"type":"error","error":"..."}
data: {"type":"done"}
```

前端点击移除已选截图时会调用 `post('discardCapture')`，Rust 端必须清空待提交的截图。

## 5. 必须完成的功能

### 5.1 消除大透明矩形框

目标：Windows 上只看到鲸鱼、气泡、输入框和状态条，不能看到一个矩形透明区域。

最低要求：

1. 窗口初始尺寸不要用 `380x560`。首帧应直接使用紧凑尺寸，例如 `168x168`，等前端布局完成后再按 UI 状态调整。
2. 在 WebView 侧确认 `html`、`body`、`.stage` 都是透明背景。
3. 调查 Tauri 2 在 Windows 上透明窗口的正确配置，必要时设置 WebView2 的透明默认背景，避免启动瞬间出现白底矩形。
4. 实现命中区域控制：空白区域不能阻挡 DeepSeek Harness 的点击，但鲸鱼、气泡、输入框、按钮仍必须可交互。

可选的实现方向，按改动量从小到大：

- 把窗口尺寸精确收紧到可见 UI 的包围盒；
- 在 Win32 层实现 `WM_NCHITTEST`，对空白区域返回 `HTTRANSPARENT`；
- 把鲸鱼、气泡/输入框拆成独立的小窗口；
- 组合使用 Tauri 的窗口大小控制与自定义命中测试。

禁止使用“整个窗口永远 click-through”这种让桌宠无法点击的方案。

### 5.2 让侧边栏隐藏按钮恢复可点击

验收条件：

- DeepSeek Harness 启动时，侧边栏隐藏按钮可正常点击；
- 桌宠可以同时显示在屏幕上；
- 桌宠图标、气泡、输入框、截图按钮、发送按钮仍然可点击；
- 桌宠拖动和滚轮缩放正常。

这个问题不是 DSH 自身的问题，修好窗口命中区域后必须实机验证。

### 5.3 实现 Windows 区域截图

用户点击输入栏截图按钮后的完整流程：

1. 桌面出现 Windows 原生区域选择界面；
2. 用户用鼠标拖拽框选任意屏幕区域；
3. 按 `Esc` 可以取消选择；
4. 选择完成后桌宠输入框打开，显示“截图已就绪”；
5. 用户输入问题并发送后，桌宠才开始调用视觉识别；
6. 识别结果以流式文本显示在气泡中。

建议实现方式：

- 使用 Win32/WinAPI 或成熟 Rust crate 完成屏幕捕获；
- 自己实现或封装一个全屏选择层，支持多显示器坐标和 DPI 缩放；
- 将选中区域编码为 JPEG，最大宽度参考 macOS 的 `1600px`，控制体积避免超出接口限制；
- 截图数据临时保存在 Rust 状态中，不要在 `Capture` 时直接提交；
- `Vision` 时检查是否存在待提交截图，不存在时通过 `renderError` 提示；
- 复用现有的 `stream_chat` 类似逻辑，把请求路径换成 `/api/pet/vision`。

在实现前先检查 Windows 上屏幕捕获是否触发系统权限提示，如果有，需要在文档中写明用户应如何授权，不能假装截图成功。

## 6. 开发与构建

在 Windows 上执行：

```powershell
cd companions\windows
.\build.ps1
```

打包 NSIS 安装包：

```powershell
.\build.ps1 -Release
```

或：

```powershell
cd companions\windows\src-tauri
cargo tauri build --bundles nsis
```

产物位置：

```text
companions\windows\src-tauri\target\release\bundle\nsis\
```

建议开发时先用 `cargo tauri dev`，这样可以看到 Rust 输出；如果 release 模式下需要调试，可临时写日志到：

```text
%TEMP%\deepseek-pet.log
```

## 7. 实机验收清单

每一项都必须在 Windows 上手动验证：

1. 安装新的 NSIS 安装包并重启 DeepSeek Harness。
2. 桌宠以紧凑状态出现，看不到 `380x560` 大矩形框。
3. 桌宠可以拖动、点击、滚轮缩放。
4. 点击鲸鱼后输入框打开，输入、粘贴、发送正常。
5. DeepSeek Harness 侧边栏隐藏按钮可正常点击。
6. 点击截图按钮后出现系统区域选择界面。
7. 按 `Esc` 取消截图，桌宠不产生对话。
8. 框选区域后输入框打开，输入问题后发送，气泡显示视觉识别结果。
9. 普通聊天、历史记录、任务状态、停止任务均正常。
10. 再次检查没有回归：桌宠开关、插件配置、桌面端对话仍正常。

## 8. 提交要求

建议在 Windows 上新建分支：

```powershell
git checkout -b windows-fix
git add -A
git commit -m "fix: Windows window hit-testing and screenshot selector"
git push -u origin windows-fix
```

实机验证通过后再合并回 `main`：

```powershell
git checkout main
git pull --ff-only origin main
git merge windows-fix
git push origin main
```

提交规范：

- 不提交 `target/`、安装包、日志等构建产物；
- Windows 专属逻辑放在 `companions/windows` 下；
- 共享前端 `companion/Resources/pet` 的改动要说明对 macOS 的影响；
- 每个修复点尽量独立提交，便于回滚和审查。

## 9. 边界与注意事项

- 不要为了消除矩形框而让桌宠在 Windows 上完全失效。
- 不要用 macOS 私有 API 逻辑硬套到 Windows。
- 截图必须等待用户输入问题后才提交，不能自动发送。
- 如果最终必须引入新 crate，优先选择纯 Rust、Windows 兼容、不要求额外系统运行时、不显著增大安装包的方案。
- GitHub Actions 当前在 `main` 和 `windows-v*` tag 上构建 Windows 安装包；分支推送不会自动构建，因此本地构建验证很重要。
