# dsh-desktop-pet

> DeepSeek 桌宠对话插件：独立置顶悬浮窗口桌宠，无需打开 DSH 聊天界面，点击桌宠即可与 DeepSeek 对话，回复以头顶气泡流式呈现。

## 这是什么

DeepSeek Harness（DSH）的桌面伴侣：一只以 DeepSeek 图标为形象的桌宠，常驻屏幕角落。

- **点击即可对话**：不用点开 DSH 聊天窗口，点桌宠弹出输入框，回车发送。
- **头顶气泡流式回复**：DeepSeek 的回答逐字出现在桌宠头顶的气泡里。
- **原生悬浮窗口**：Swift 实现，透明、无边框、永远置顶；DSH 主窗口关闭（托盘常驻）时桌宠依然在线。
- **纯聊天模式**：走官方轻量 LLM 通道（`ctx.llm.stream`），不经过完整 agent 循环，快且省。
- **滚动记忆**：默认保留最近 12 轮对话，持久化到 `$DSH_HOME/pet-chat.json`。
- **模型跟随全局**：默认使用 DSH 设置的默认模型（provider/model/reasoning），可单独覆盖。

## 架构

```
桌面
├─ companion/  Swift 伴生应用（透明置顶小窗口 + WKWebView）
│    └─ 宠物渲染（DeepSeek 图标 + CSS 动画）+ 头顶气泡 + 输入框
│         │  HTTP loopback + SSE
├─ plugin/     DSH 插件 host 半区（cordis）
│    ├─ /api/pet/chat     POST → SSE 流式回复（ctx.llm.stream）
│    ├─ /api/pet/config   读取配置/模型
│    ├─ /api/pet/memory   清空记忆
│    ├─ /api/pet/bridge   刷新端口桥
│    └─ /api/pet/health   健康检查
└─ $DSH_HOME/pet-bridge.json（端口发现：伴生应用由此找到 host）
```

## 安装

### 1. 安装插件（host 半区）

把 `plugin/` 目录加入 dsh profile 依赖，并在 profile 的 `cordis.patch.yml` 追加：

```yaml
- insert:
    - id: desktop-pet
      name: '@linxin666/dsh-desktop-pet'
```

示例（web profile）：

```sh
cd ~/.dsh/profiles/web
pnpm add "file:/path/to/dsh-desktop-pet/plugin"
# 编辑 cordis.patch.yml 追加上面两行
```

重启 DeepSeek Harness 后验证：

```sh
curl -s http://127.0.0.1:55332/api/pet/health
# => {"ok":true,...}
```

### 2. 构建伴生应用（macOS）

```sh
cd companion
xcodebuild -project DeepSeekPet.xcodeproj -scheme DeepSeekPet build
# 产物: build/Release/DeepSeekPet.app
```

双击运行，桌宠出现在屏幕右下角。

## 对话 API

```sh
curl -N -X POST http://127.0.0.1:55332/api/pet/chat \
  -H 'content-type: application/json' \
  -d '{"message":"你好呀"}'
# data: {"type":"start"}
# data: {"type":"delta","text":"你好！"}
# ...
# data: {"type":"done"}
```

## 开发

```sh
node --check plugin/src/*.js   # 语法检查（纯 ESM JS，无构建步骤）
```

## License

Apache-2.0
