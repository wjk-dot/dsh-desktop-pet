# dsh-desktop-pet

> DeepSeek 桌宠对话插件：一只住在你屏幕上的鲸鱼小助手。无需打开 DeepSeek Harness 聊天界面，点击桌宠即可与 DeepSeek 对话，回复以头顶气泡流式呈现。

## 功能

- 🐋 **DeepSeek 图标形象**：第一版桌宠即 DeepSeek 官方图标，纯 CSS 动画驱动（待机漂浮 / 聆听摇摆 / 思考光晕 / 说话弹跳 / 离线灰阶）。
- 💬 **点击即聊**：点桌宠弹出输入框，回车发送；DeepSeek 的回答逐字出现在头顶气泡中（打字机效果）。
- 🪟 **原生悬浮窗口**：Swift + WKWebView 实现，透明、无边框、永远置顶、可拖动、位置记忆；DSH 主窗口关闭（托盘常驻）时桌宠依然在线。
- ⚡ **轻量对话通道**：走官方 `ctx.llm.stream()`，不经过完整 agent 循环——快、省、纯聊天。
- 🧠 **滚动记忆**：默认保留最近 12 轮，持久化 `$DSH_HOME/pet-chat.json`；托盘可一键清空。
- 🔌 **零配置发现**：插件把监听端口写入 `$DSH_HOME/pet-bridge.json`，伴生应用自动找到 host；DSH 重启换端口也能自愈。

## 目录结构

```
dsh-desktop-pet/
├── plugin/      # DSH 插件 host 半区（cordis）：chat SSE 通道 + 记忆 + 端口桥
└── companion/   # Swift 伴生应用：透明置顶窗口 + 宠物页面 + SSE 客户端
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
curl -s http://127.0.0.1:<port>/api/pet/health   # {"ok":true,...}
```

### 2. 构建并运行桌宠（macOS）

```sh
cd companion
./build.sh          # 产出 build/DeepSeekPet.app
open build/DeepSeekPet.app
```

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
│    ├─ /api/pet/chat   POST → ctx.llm.stream → SSE 逐字
│    ├─ /api/pet/config / memory / bridge / health
│    └─ $DSH_HOME/pet-bridge.json（端口发现）
```

- 对话模型默认跟随 DSH 全局设置（`agent-default-model`），可独立覆盖。
- 纯聊天模式：不调用工具、不进入 agent 循环。
- DSH 桌面应用关窗仅隐藏主窗口，host 子进程持续运行 → 桌宠不受影响。

## 开发

```sh
node --check plugin/src/*.js     # 插件语法检查（纯 ESM JS，无构建）
cd companion && swift build      # 伴生应用调试构建
```

## 路线图

- [x] MVP：chat SSE 通道 + Swift 置顶窗口 + 气泡对话 + 记忆
- [ ] 形象系统：换肤/自定义宠物（pet.json 已预留抽象）
- [ ] 语音输入、开机自启、多屏记忆
- [ ] 与 DSH 会话活动联动动画

## License

Apache-2.0
