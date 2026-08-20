/**
 * dsh-desktop-pet host 半区入口：挂载原生 Agent 会话投影 + 路由 + 端口桥
 * + 生命周期联动（DSH 启动时按开关状态拉起桌宠；DSH 退出时桌宠自行退出）。
 * 安装方式见 README：把本包加入 dsh profile，并在 profile 的
 * cordis.patch.yml 插入一行 { id: desktop-pet, name: '@linxin666/dsh-desktop-pet' }。
 */

import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { PetChatService } from './chat.js'
import { removeBridgeFile, writeBridgeFile } from './bridge.js'
import { loadEnabled, saveEnabled } from './control.js'
import { defaultCompanionApp, launchCompanion } from './launch.js'
import { makePetRoutes } from './routes.js'
import { PetEventHub } from './event-hub.js'

/** 稳定的 cordis 插件名（与 patch 插入行 id 对应）。 */
export const name = 'desktop-pet'

/** 依赖服务：web 服务器、原生会话 API、工作区注册表、默认模型和设置服务。 */
export const inject = ['webServer', 'llm', 'agentDefaultModel', 'workspaceRegistry', 'apiProxy', 'sessions', 'settings']

export { defaultCompanionApp, launchCompanion }

/** Host 配置页使用的稳定 namespace，必须与客户端卡片的 key 保持一致。 */
export const DESKTOP_PET_SETTINGS_NAMESPACE = settingsNamespace('desktop-pet')

export const Config = z.object({
  personaName: z.string().default('小鲸鱼'),
  systemPrompt: z.string().default(''),
  maxHistoryTurns: z.number().step(1).min(1).default(12),
  temperature: z.number().min(0).default(0.7),
  maxTokens: z.number().step(1).min(1).default(4096),
  model: z.object({
    provider: z.string().default(''),
    model: z.string().default(''),
    reasoningEffort: z.string().default(''),
  }).default({}),
  companionApp: z.string().default(''),
})

const runtimeKey = Symbol.for('@linxin666/dsh-desktop-pet/runtime')

function activeRuntime() {
  return globalThis[runtimeKey]
}

function setActiveRuntime(runtime) {
  globalThis[runtimeKey] = runtime
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {import('./chat.js').PetChatConfig & {companionApp?: string}} [config]
 */
export function apply(ctx, config = {}) {
  installSettingsSection(ctx, DESKTOP_PET_SETTINGS_NAMESPACE, Config, config, {
    setSource: () => {},
    onChange: () => {},
  })

  // HMR can briefly overlap Fibers. Dispose the previous module-owned runtime
  // before registering exact routes so an old Fiber cannot poison boot.
  activeRuntime()?.dispose('replaced')
  const instanceId = randomUUID()
  const eventHub = new PetEventHub()
  const service = new PetChatService(ctx, config, eventHub)
  void service.refreshHistory().catch((error) => {
    ctx.logger.warn(`desktop-pet: unable to initialize native session: ${error instanceof Error ? error.message : String(error)}`)
  })

  // Schemastery applies the empty-string default before this function runs;
  // treat it as "auto-detect" so it cannot mask the platform default.
  const companionApp = config.companionApp?.trim() || defaultCompanionApp()
  ctx.logger.info(`desktop-pet: companionApp 解析结果 = ${companionApp ? companionApp : '(空)'}`)

  // 刷新端口桥：插件挂载时写一次（桥文件携带桌宠开关状态）。
  const writeBridge = () => writeBridgeFile(ctx.webServer.port, { instanceId })
  writeBridge()
  const bridgeHeartbeat = setInterval(writeBridge, 5_000)

  // 生命周期联动：DSH 启动时若桌宠开关为开，拉起伴生应用
  // （幂等；开关为关则保持不启动，等待界面开关打开时再拉起）。
  if (loadEnabled() && companionApp) {
    launchCompanion(companionApp)
  } else {
    ctx.logger.info(`desktop-pet: 未拉起伴生应用（enabled=${loadEnabled()}, companionApp=${companionApp ? '有' : '无'}）`)
  }

  // 注册路由，随插件 fiber 自动卸载。
  const disposers = []
  try {
    for (const route of makePetRoutes({ service, writeBridge, loadEnabled, saveEnabled, companionApp, eventHub, instanceId })) {
      disposers.push(ctx.webServer.register(route))
    }
  } catch (error) {
    clearInterval(bridgeHeartbeat)
    for (const disposer of disposers.reverse()) disposer()
    eventHub.dispose()
    service.dispose()
    removeBridgeFile(instanceId)
    throw error
  }
  let disposed = false
  const dispose = (reason) => {
    if (disposed) return
    disposed = true
    clearInterval(bridgeHeartbeat)
    for (const disposer of disposers.reverse()) disposer()
    eventHub.dispose()
    try {
      service.memory.save()
      service.dispose()
    } catch {
      // 落盘失败不影响退出
    }
    removeBridgeFile(instanceId)
    if (activeRuntime()?.instanceId === instanceId) setActiveRuntime(undefined)
    ctx.logger.info(`desktop-pet: disposed ${instanceId} (${reason})`)
  }
  setActiveRuntime({ instanceId, dispose })
  ctx.on('dispose', () => dispose('fiber-dispose'))
}
