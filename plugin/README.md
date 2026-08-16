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
# 注意：用 link:（符号链接）而不是 file:（拷贝）——开发迭代时改动即时生效；
# pnpm 的 file: 会拷贝一份旧副本，宿主加载的是副本，改代码不生效。
pnpm add "link:/path/to/dsh-desktop-pet/plugin"
# 编辑 cordis.patch.yml 追加上面两行
```

插件运行时会 import `@deepseek-ai/dsh-llm`（peer 依赖）。`link:` 安装后模块的真实路径在
插件源码目录，需让 Node 能解析到 DSH 的包（二选一）：

```sh
# 方式 A：把宿主 node_modules 的 @deepseek-ai 链到插件目录（推荐，开发机）
ln -sfn "/Applications/DeepSeek Harness.app/Contents/Resources/host/node_modules/@deepseek-ai" \
  /path/to/dsh-desktop-pet/plugin/node_modules/@deepseek-ai

# 方式 B：把 @deepseek-ai 声明为 devDependencies 并 pnpm install（发布机）
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
