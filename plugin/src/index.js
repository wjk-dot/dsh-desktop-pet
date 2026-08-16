/**
 * dsh-desktop-pet host 半区入口：挂载对话服务 + 路由 + 端口桥。
 * 安装方式见 README：把本包加入 dsh profile，并在 profile 的
 * cordis.patch.yml 插入一行 { id: desktop-pet, name: '@linxin666/dsh-desktop-pet' }。
 */

import { PetChatService } from './chat.js'
import { writeBridgeFile } from './bridge.js'
import { makePetRoutes } from './routes.js'

/** 稳定的 cordis 插件名（与 patch 插入行 id 对应）。 */
export const name = 'desktop-pet'

/** 依赖服务：web 服务器（挂路由）、LLM 通道、全局默认模型。 */
export const inject = ['webServer', 'llm', 'agentDefaultModel']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {import('./chat.js').PetChatConfig} [config]
 */
export function apply(ctx, config = {}) {
  const service = new PetChatService(ctx, config)

  // 刷新端口桥：插件挂载时写一次；伴生应用也可 POST /api/pet/bridge 强制刷新。
  const writeBridge = () => writeBridgeFile(ctx.webServer.port)
  writeBridge()

  // 注册路由，随插件 fiber 自动卸载。
  const routes = makePetRoutes({ service, writeBridge })
  ctx.effect(
    () => {
      const disposers = routes.map((route) => ctx.webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    },
    'desktop-pet: routes',
  )

  ctx.on('dispose', () => {
    try {
      service.memory.save()
    } catch {
      // 落盘失败不影响退出
    }
  })
}
