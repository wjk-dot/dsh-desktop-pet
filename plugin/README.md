# dsh-desktop-pet

> DeepSeek 桌宠对话插件：独立置顶悬浮窗口桌宠，无需打开 DSH 聊天界面，点击桌宠即可与 DeepSeek 对话，回复以头顶气泡流式呈现。

## 这是什么

DeepSeek Harness（DSH）的桌面伴侣：一只以 DeepSeek 图标为形象的桌宠，常驻屏幕角落。

- **点击即可对话**：不用点开 DSH 聊天窗口，点桌宠弹出输入框，回车发送。
- **头顶气泡流式回复**：DeepSeek 的回答逐字出现在桌宠头顶的气泡里。
- **原生悬浮窗口**：Swift 实现，透明、无边框、永远置顶；DSH 主窗口关闭（托盘常驻）时桌宠依然在线。
- **原生会话**：启动后会在当前工作区创建或恢复固定的 `桌宠对话` session，直接出现在左侧会话列表。
- **双端连续对话**：桌宠发言与 Harness 界面发言进入同一个 Agent session；两边都能看到记录并继续同一上下文。
- **事件驱动投影**：`/api/pet/events` 提供带序号和重放窗口的 SSE，桌面端任务不用等历史轮询才出现在桌宠上。
- **可靠生命周期**：桥文件有 host `instanceId` 和租约，插件 HMR/重启会先撤销上一个 runtime 的路由、订阅和桥所有权。
- **Codex 风格执行伴侣**：桌宠投影与 Harness 相同的 Agent 执行链；桌面端或桌宠端发起的工具任务都会显示运行状态，并可从桌宠取消。
- **原生插件配置卡**：在 `设置 → 插件 → 插件配置 → DeepSeek 桌宠` 中调整启用状态、图标尺寸、任务状态显示、动画和自动贴边。
- **历史迁移**：旧版 `$DSH_HOME/pet-chat.json` 会作为首次原生会话的上下文导入；已有 `桌宠对话记录.md` 保留为旧备份，不再自动生成。
- **模型跟随全局**：默认使用 DSH 设置的默认模型（provider/model/reasoning），可单独覆盖。
- **可选截图分析**：从桌宠显式截取主屏，图片作为同一原生 Agent session 的附件保存；配置 Qwen MCP 后可进行 OCR、界面理解与视觉问答。

## 架构

```
桌面
├─ companion/  Swift 伴生应用（透明置顶小窗口 + WKWebView）
│    └─ 宠物渲染（DeepSeek 图标 + CSS 动画）+ 头顶气泡 + 输入框
│         │  HTTP loopback + SSE
├─ plugin/     DSH 插件 host 半区（cordis）
│    ├─ /api/pet/chat     POST → SSE 流式转发原生 Agent session
│    ├─ /api/pet/vision   POST JPEG → 同一 session 图片附件 + Qwen MCP 指令
│    ├─ /api/pet/events   原生 session 事件 SSE（支持 after=<seq> 重放）
│    ├─ /api/pet/history / status / cancel / control / preferences
│    ├─ /api/pet/bridge   刷新端口桥（实例租约）
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

### 3. 配置桌宠

打开 Harness 的 `设置 → 插件 → 插件配置`，展开 `DeepSeek 桌宠`。配置保存后通过
SSE 立即同步到已经运行的原生桌宠，无需重启 companion：

- `启用桌宠`：隐藏或恢复桌宠窗口，不影响已有 Agent 会话；
- `图标尺寸`：70 到 200 px；
- `显示任务状态`：显示当前 Agent 的工具执行状态和取消入口；
- `减少动画`：关闭桌宠的持续动画和过渡；
- `自动贴边隐藏`：控制拖到屏幕边缘后的自动收起。
- `启用截图分析`：允许桌宠上的截图按钮提交图片；未配置 Qwen 时仍会保留图片和请求，但 Agent 会明确提示缺少视觉 MCP。

偏好保存在 `$DSH_HOME/pet-preferences.json`，而不是修改 DSH 应用包或受限的通用 settings namespace。

### 可选：Qwen 截图分析

视觉能力不随插件携带任何模型凭据。到阿里云百炼（DashScope）控制台创建 API Key 后，在
Harness 的 `设置 → 插件 → DeepSeek 桌宠 → Qwen 视觉凭据` 粘贴并保存即可。Key 只会写入
`$DSH_HOME/pet-qwen-mm.env`，权限为 `0600`，界面只显示末四位。

随后执行：

```sh
cd plugin
./install-vision.sh
```

脚本会安装 `qwen-mm-plugins-api` skill，并打印需要加入当前 DSH profile 的 MCP 配置。
把 `qwen-vision.patch.yml` 中的条目合并到 profile 的 `cordis.patch.yml` 后重启 Harness。MCP 启动时会读取
上述桌宠私有配置文件；保存或更换 Key 后同样需要重启 Harness。`uvx`、Qwen 凭据和 MCP 均在本机运行；不要把
`$DSH_HOME/pet-qwen-mm.env` 提交到仓库。

完成后，在桌宠输入栏点击截图按钮即可截取**主显示器**并携带当前输入框中的问题发送。macOS 会在首次使用时请求“屏幕录制”权限。插件不会后台录屏或定时截图；临时 JPEG 仅供本机 MCP 读取，最多保留 30 分钟。当前 DeepSeek Agent 模型不支持图片输入，因此 Harness 历史会保留截图分析任务、Qwen 工具调用和结果，而不会把 JPEG 作为模型附件提交。

### 2. 构建伴生应用（macOS）

```sh
cd companion
xcodebuild -project DeepSeekPet.xcodeproj -scheme DeepSeekPet build
# 产物: build/Release/DeepSeekPet.app
```

双击运行，桌宠出现在屏幕右下角。开关使用 macOS 菜单栏桌宠图标，不向 Harness 页面注入可能遮挡原生控件的悬浮按钮。

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
