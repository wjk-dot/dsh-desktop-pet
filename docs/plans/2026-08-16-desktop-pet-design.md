# DSH 桌宠对话插件 · 项目策划书

> 日期：2026-08-16 ｜ 状态：已确认，待排实现计划

## 1. 项目概述

### 1.1 背景

- DeepSeek Harness（DSH）桌面应用是 Electron 壳 + Node host 子进程 + Web 前端（`dsh web`）的架构。host 为 cordis 插件系统，插件分 host 半区（Node，注册 HTTP 路由/服务）与浏览器半区（React，挂在 Web GUI 的 `document.body`）。
- 系统已安装 `@linxin666/dsh-pet`「鲸鱼娘」Web 浮层宠物：有状态动画、摸头、喂食、亲密度、拖动、改名、隐藏/召唤，但它**只能反映会话状态，不能对话**，且必须在 Web 界面打开时才可见。
- 用户诉求：一只真正的**桌面桌宠**——不需要打开 DSH 对话窗口，点它就能聊"简单对话"，回复以**头顶气泡**流式呈现。

### 1.2 目标

> 做一个原生置顶悬浮小窗口桌宠，独立于 DSH 聊天界面运行；点击桌宠弹出输入框即可对话，LLM 回复以流式气泡呈现在桌宠头顶；DSH 主窗口关闭（托盘常驻）时桌宠仍可用。

### 1.3 已有基础（可复用资产）

| 资产 | 说明 | 来源 |
|---|---|---|
| DeepSeek 官方图标 | 已从应用包 `icon.icns` 提取为 PNG（540KB，官方鲸鱼造型） | `/Applications/DeepSeek Harness.app/Contents/Resources/icon.icns` |
| dsh-pet 鲸鱼娘图集 | 9 状态 × 8 列 webp 图集 + 动画轨道定义 | `@linxin666/dsh-pet`（BSD-3-Clause，v2 可选） |
| host LLM 通道 | `ctx.llm.stream()` 直连提供商，免 agent 循环 | 官方 `dsh-llm`（会话标题生成同款通道，已确认可用） |
| 路由注册模式 | 插件自注册 `/api/pet/*` + `/pet/*` 静态路由 | `@linxin666/dsh-pet`（同模式） |

### 1.4 已确认决策（用户拍板）

1. **载体**：原生悬浮窗口（不用打开 DSH 界面）。
2. **技术栈**：Swift 原生壳（AppKit + WKWebView），宠物本体用 HTML/CSS/JS 渲染。
3. **形象 v1**：DeepSeek 官方图标样式（CSS 动画驱动，无图集依赖），v2 起可替换。

## 2. 总体架构

```
macOS 桌面
│
├─ 伴生应用 dsh-pet-companion（Swift .app，透明无边框置顶小窗）
│    └─ WKWebView
│         ├─ 宠物渲染（v1: DeepSeek 图标 + CSS 动画）
│         ├─ 头顶对话气泡（流式）
│         └─ 点击弹出的输入框
│              │  HTTP loopback（127.0.0.1）+ SSE 流式
│              ▼
├─ DSH Host（Node 子进程，托盘常驻；主窗口关闭仅 hide()，host 存活）
│    └─ dsh-desktop-pet 插件（cordis host 半区）
│         ├─ /api/pet/chat      POST {message} → SSE 流式回复
│         ├─ /api/pet/config    读取/修改人格与记忆配置
│         ├─ PetChatService：ctx.llm.stream + 人格 prompt + 滚动记忆
│         └─ ~/.dsh/pet-bridge.json（端口发现文件，随启动写入/更新）
```

**关键机制**：Electron 主进程 `onWindowClose` 只执行 `hide()`（已读源码确认），host 子进程持续运行——DSH 应用缩进托盘、主窗口关闭后，桌宠聊天通道依然在线。这从架构上保证了"不用点开对话窗口"。

## 3. 组件设计

### 3.1 插件 host 半区（对话通道，本项目技术核心）

- 新插件 `dsh-desktop-pet`（cordis bundle，v1 仅 host 半区；浏览器半区仅提供设置项可选）。
- 路由（复用 dsh-pet 的 `ctx.webServer.register` 模式）：
  - `POST /api/pet/chat`：body `{ message: string, sessionId?: string }`，响应 `text/event-stream`，逐字下发 `{ delta }` 事件，结束时 `{ done }`；出错 `{ error }`。
  - `GET /api/pet/config` / `POST /api/pet/config`：人格 prompt、模型、记忆轮数等。
- 对话实现：
  - 调官方 `ctx.llm.stream()`（注入 `llm` 服务，签名实现时对照 `dsh-session-title-llm` 确认），**不经过完整 agent 循环**——快、省、符合"简单对话"。
  - 人格 system prompt：默认"DeepSeek 小助手——简洁、准确、贴心、偶尔俏皮；纯聊天，不调用任何工具"，可在配置中修改。
  - 模型：默认跟随全局 `agent-default-model`（当前 deepseek-v4-flash / reasoningEffort high），可独立覆盖。
  - 记忆：滚动窗口最近 N 轮（默认 12），每会话独立；持久化 `~/.dsh/pet-chat.json`（原子写入，复用 dsh-pet 的 persist 模式）。
- 端口发现：
  - 插件 apply 时读 `ctx.webServer.port`，写 `~/.dsh/pet-bridge.json`：`{ port, pid, version, startedAt }`；端口变化即重写。
  - 伴生应用启动时读该文件连接；失败进入离线态并轮询重试。

### 3.2 伴生窗口（Swift）

- `NSWindow`：透明背景、无边框、`level = .floating`（置顶）、`collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]`；宠物本体外区域鼠标事件穿透（`ignoresMouseEvents` + 热区判断）；按住宠物可拖动，位置持久化到 `UserDefaults`。
- `WKWebView` 加载插件提供的宠物页面（HTML/CSS/JS 内嵌于 companion 的 `Resources/pet/`，或从 `http://127.0.0.1:PORT/pet/…` 加载——v1 内嵌，避免强依赖端口在线才能渲染）。
- 原生壳 ↔ 页面通信：`WKScriptMessageHandler` 双向通道（壳侧事件：发送消息、窗口拖动、退出；页侧事件：气泡高度变化、输入框聚焦）。
- 托盘图标（NSStatusItem）：显示/隐藏、退出、开机自启（v1 可先不做自启）。
- 生命周期：跟随 DSH 应用运行（DSH 退出 → 离线态提示"DeepSeek Harness 未运行"）；可选"随 DSH 启动"（v2）。

### 3.3 桌宠形象 v1：DeepSeek 图标 + CSS 动画

- 素材：DeepSeek 官方图标（已提取，`docs/plans/deepseek-icon-source.png` 备份；实现时从 `icon.icns` 再提一张 256px 透明底 PNG 入 `Resources/pet/`）。
- 动画（纯 CSS，零图集成本）：
  | 状态 | 表现 |
  |---|---|
  | `idle` | 上下轻微漂浮 + 缓慢左右摇摆 |
  | `listening` | 停顿 + 轻微放大微摆（等待输入） |
  | `thinking` | 左右轻晃 + 底部光晕脉冲（等待 LLM） |
  | `speaking` | 有节奏上下弹跳 + 气泡呼吸缩放 |
  | `offline` | 灰阶滤镜 + 缓慢闪烁 |
- 可替换性：形象抽象为 `Resources/pet/pet.json`（形象标识、素材路径、动画参数、气泡偏移），v2 换鲸鱼娘图集或自绘形象只换目录不动壳。

### 3.4 交互设计

1. 点击桌宠 → 头顶展开输入框（小圆角卡片，Enter 发送，Esc 收回）。
2. 发送 → 输入框收回，宠物切 `thinking`，气泡显示"……"。
3. 回复 SSE 逐字流入气泡（打字机效果），结束后宠物切 `speaking` 短暂庆祝再回 `idle`。
4. 再次点击宠物可继续对话；对话上下文在同一 sessionId 内连续。
5. 长按/右键宠物 → 快捷菜单：隐藏、改形象、清空记忆、退出（v1 可用托盘菜单代替右键）。

### 3.5 数据流

```
用户点击宠物 → 输入框 → POST /api/pet/chat {message}
   → host: PetChatService 组装 [系统人格] + [滚动记忆] + [本次消息]
   → ctx.llm.stream() → SSE 逐字 → companion 气泡打字机渲染
   → 结束时记忆追加 (user, assistant) 持久化 pet-chat.json
```

## 4. MVP 范围（第一期）

| 做 | 不做（YAGNI，留 v2） |
|---|---|
| chat SSE 通道 + 人格 + 滚动记忆 | 语音输入 / 朗读 |
| Swift 置顶透明窗口 + 宠物渲染 | 完整 agent 工具调用（保持纯聊天） |
| 气泡 + 输入框 + 拖动 + 托盘菜单 | 多宠物 / 皮肤中心 |
| 端口发现 + 离线态 + 重试 | 与 dsh-pet 亲密度/小鱼干联动 |
| 形象抽象（v1 = DeepSeek 图标） | 镜像 DSH 会话活动动画 |
| 记忆持久化 | 开机自启 / 随 DSH 启动 |

## 5. 目录结构

```
dsh-desktop-pet/
├── docs/plans/
│   ├── 2026-08-16-desktop-pet-design.md   # 本策划书
│   └── deepseek-icon-source.png           # 官方图标备份
├── plugin/                                # cordis 插件（host 半区）
│   ├── src/
│   │   ├── index.ts                       # 插件入口（apply、路由注册）
│   │   ├── chat.ts                        # PetChatService：llm.stream + SSE
│   │   ├── persona.ts                     # 人格 prompt 模板
│   │   ├── memory.ts                      # 滚动记忆 + pet-chat.json 持久化
│   │   ├── bridge.ts                      # pet-bridge.json 端口发现
│   │   └── routes.ts                      # /api/pet/chat、/api/pet/config
│   └── package.json / cordis.patch.yml
└── companion/                             # Swift 伴生应用
    ├── Sources/
    │   ├── main.swift                     # AppKit 入口、NSWindow、托盘
    │   ├── PetWindow.swift                # 透明置顶窗口 + 拖动 + 穿透
    │   ├── PetWebView.swift               # WKWebView + 消息桥
    │   └── Bridge.swift                   # 读 bridge 文件、SSE 客户端
    ├── Resources/pet/                     # 宠物页面（index.html + pet.js + pet.css + icon.png + pet.json）
    └── project.yml                        # XcodeGen 工程定义
```

## 6. 技术风险与对策

| 风险 | 对策 |
|---|---|
| 透明窗口点击穿透与交互冲突 | `ignoresMouseEvents` + 宠物/输入框热区判定，分区域开关 |
| host 端口每次启动可能变化 | bridge 文件 + 启动重试 + 文件 watch |
| loopback 直连被 `/api` 信任围栏拦截 | 已实测插件静态路由 `GET /pet/whale/pet.json` 返回 200；chat 路由同模式注册，实现时验证 |
| `ctx.llm.stream` 服务签名不确定 | 以 `dsh-session-title-llm` 为范本对照 `dsh-llm` 类型定义 |
| SSE 与 Web 前端同源限制 | companion 是原生 HTTP 客户端（非浏览器），无 CORS 限制；`Host: 127.0.0.1` 过 loopback 围栏 |
| Swift 工程搭建成本 | 用 XcodeGen 生成工程，命令行 `xcodebuild` 构建（本机已具备）；先以最小壳验证窗口透明/置顶/穿透 |
| 官方图标版权/观感 | 用的是 DSH 自身应用图标，天然合法；CSS 滤镜可做离线灰阶等状态区分 |

## 7. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| M1 | 插件 chat 通道（host 半区 + SSE + 人格 + 记忆 + bridge 文件） | `curl -N -X POST …/api/pet/chat` 可见逐字流式回复 |
| M2 | Swift 壳：透明置顶窗口 + WKWebView 渲染宠物页 | 桌宠上屏、可拖动、鼠标穿透正确 |
| M3 | 接线：点击→输入→SSE→气泡打字机 | 完整对话闭环，主窗口关闭后仍可聊 |
| M4 | 打磨：托盘菜单、离线态、记忆持久化、形象配置 | 连续使用 30 分钟无异常 |

## 8. 后续演进（v2+，暂不排期）

- 形象系统：换回鲸鱼娘图集动画 / 自绘多形象 / 皮肤中心。
- 与 DSH 会话联动：镜像主窗口会话活动动画（复用 dsh-pet state 逻辑）。
- 升级对话：可选"深度模式"（临时挂载到完整 agent 会话，可用工具）。
- 开机自启、随 DSH 启动/退出联动、多屏记忆。
- 语音输入（macOS 内置听写）。
