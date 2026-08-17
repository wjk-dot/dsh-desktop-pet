# dsh-desktop-pet

> DeepSeek Harness 的紧凑 Agent 投影：桌宠与 Harness 左侧的 `桌宠对话` 使用同一条原生 session，可在两端继续同一条执行链。

## 功能

- 🐋 **DeepSeek 图标形象**：第一版桌宠即 DeepSeek 官方图标，纯 CSS 动画驱动（待机漂浮 / 聆听摇摆 / 思考光晕 / 说话弹跳 / 离线灰阶）。
- 💬 **点击即聊**：点桌宠弹出输入框，回车发送；DeepSeek 的回答逐字出现在头顶气泡中（打字机效果）。
- 📐 **桌面端同款渲染**：气泡用与 DSH 桌面端对齐的渲染栈（Markdown + KaTeX 公式 + highlight.js 代码高亮 + DOMPurify 消毒）——公式、代码块、表格、加粗都正常显示，不再是原始标记。
- 🪟 **原生悬浮窗口**：Swift + WKWebView 实现，透明、无边框、永远置顶、可拖动、位置记忆；DSH 主窗口关闭（托盘常驻）时桌宠依然在线。
- 🤖 **完整 Agent 执行链**：通过官方 `apiProxy.sessions` 驱动原生 session，桌宠任务与桌面端共享工具调用、工作区、取消和会话历史。
- 🔁 **双端连续会话**：桌宠启动后在当前工作区创建或恢复固定的 `桌宠对话` session；左侧工作区栏中可以直接打开、继续和审计它。
- ⚡ **事件驱动同步**：host 将原生 session 事件投影为可恢复 SSE 流；伴生应用只在事件到达时刷新状态/历史，不再靠高频轮询拖慢开关。
- 🛡️ **实例租约**：端口桥记录 `instanceId` 和过期时间；重启/HMR 时旧伴生连接不能污染新 host。
- 🔄 **与 DSH 生命周期联动**：DSH 彻底退出时桌宠一起退出；重新打开时按上次开关状态自动恢复（开启则拉起桌宠、关闭则保持关闭）
- 🔌 **零配置发现**：插件把监听端口写入 `$DSH_HOME/pet-bridge.json`，伴生应用自动找到 host；DSH 重启换端口也能自愈。
- 👁️ **可选 Qwen 视觉**：用户点击桌宠截图按钮后，主屏截图交给本机 Qwen MCP 识别；分析任务、工具调用和结果进入同一条 Harness Agent 执行链。

## 目录结构

```
dsh-desktop-pet/
├── plugin/      # DSH 插件 host 半区（cordis）：chat SSE 通道 + 记忆 + 端口桥
└── companion/   # Swift 伴生应用：透明置顶窗口 + 宠物页面 + SSE 投影客户端
```

## 快速开始

### 1. 安装插件（host 半区）

把 `plugin/` 加入 dsh profile 依赖，并在 profile 的 `cordis.patch.yml` 追加：

```yaml
- insert:
    - id: desktop-pet
      name: '@linxin666/dsh-desktop-pet'
```

```sh
cd ~/.dsh/profiles/web
pnpm add "file:/path/to/dsh-desktop-pet/plugin"
```

重启 DeepSeek Harness（或等待 patch 热加载），验证：

```sh
cat ~/.dsh/pet-bridge.json
curl -s http://127.0.0.1:<port>/api/pet/health   # {"ok":true,"instanceId":"...",...}
```

### 2. 构建并运行桌宠（macOS）

```sh
cd companion
./build.sh          # 产出 build/DeepSeekPet.app
open build/DeepSeekPet.app
```

### 3. 可选安装 Qwen 截图分析

视觉功能不打包模型或凭据。到阿里云百炼（DashScope）控制台创建 API Key 后，在 Harness 的
`设置 → 插件 → DeepSeek 桌宠` 中展开 `Qwen 视觉凭据`，粘贴并保存。Key 仅写入本机
`$DSH_HOME/pet-qwen-mm.env`（权限 `0600`，界面只显示末四位）。随后运行：

```sh
cd plugin
./install-vision.sh
```

将脚本输出的 `qwen-vision.patch.yml` 条目合并到当前 profile 的 `cordis.patch.yml`，然后重启 Harness；保存或更换 Key 后也需要重启一次。
首次在桌宠输入栏点击截图按钮时，macOS 会请求“屏幕录制”权限。不会后台录屏；截图仅在用户点击后生成，临时 MCP 输入最多保留 30 分钟。完整步骤见 [plugin/README.md](plugin/README.md#可选qwen-截图分析)。

## 对话 API

```sh
curl -N -X POST http://127.0.0.1:<port>/api/pet/chat \
  -H 'content-type: application/json' \
  -d '{"message":"你好呀"}'
# data: {"type":"start"}
# data: {"type":"delta","text":"你好！"} ...
# data: {"type":"done"}
```

## 原理

```
桌面
├─ companion/（Swift 置顶小窗 + WKWebView）
│    └─ DeepSeek 图标 + CSS 动画 + 气泡 + 输入框
│         │  HTTP loopback + SSE 流式
├─ plugin/（cordis host 半区，随 DSH 运行）
│    ├─ /api/pet/chat   POST → apiProxy 原生 Agent session → SSE 逐字
│    ├─ /api/pet/vision POST JPEG → 本机 Qwen MCP 图像路径 + 原生 session 文本任务
│    ├─ /api/pet/events GET  → session/event 投影 + 有界重放
│    ├─ /api/pet/history / status / cancel / control
│    └─ $DSH_HOME/pet-bridge.json（端口 + instanceId + 租约）
```

- `桌宠对话` 是唯一事实来源；不要将其替换为另一个独立的 LLM 聊天记录。
- 桌宠可执行普通 Agent 任务；权限确认和高风险操作仍回到完整 Harness 界面处理。
- 网页内悬浮开关已移除，避免遮挡 Harness 原生控件；使用 macOS 菜单栏桌宠图标的开关。
- DSH 桌面应用关窗仅隐藏主窗口，host 子进程持续运行 → 桌宠不受影响。

## 开发

```sh
node --check plugin/src/*.js     # 插件语法检查（纯 ESM JS，无构建）
cd companion && swift build      # 伴生应用调试构建
```

## 路线图

- [x] MVP：原生 session + Swift 置顶窗口 + 气泡对话 + 双端历史
- [x] Cordis 生命周期/事件升级：实例租约、HMR 清理、SSE 投影
- [ ] 形象系统：换肤/自定义宠物（pet.json 已预留抽象）
- [ ] 语音输入、开机自启、多屏记忆
- [ ] 完整会话跳转、任务摘要与审批回到桌面端的 handoff

## License

Apache-2.0
