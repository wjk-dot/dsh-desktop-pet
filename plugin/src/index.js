/**
 * dsh-desktop-pet host 半区入口：挂载对话服务 + 路由 + 端口桥 + DSH 界面开关。
 * 安装方式见 README：把本包加入 dsh profile，并在 profile 的
 * cordis.patch.yml 插入一行 { id: desktop-pet, name: '@linxin666/dsh-desktop-pet' }。
 */

import { readFileSync } from 'node:fs'
import { PetChatService } from './chat.js'
import { writeBridgeFile } from './bridge.js'
import { loadEnabled, saveEnabled } from './control.js'
import { makePetRoutes } from './routes.js'

/** 稳定的 cordis 插件名（与 patch 插入行 id 对应）。 */
export const name = 'desktop-pet'

/** 依赖服务：web 服务器（挂路由/注入开关）、LLM 通道、全局默认模型。 */
export const inject = ['webServer', 'llm', 'agentDefaultModel']

/**
 * 注入到 DSH 界面左下角的桌宠开关脚本（<script> 标签体，见 toggle.js）。
 * 每次 index.html 响应时从磁盘读取——改 toggle.js 后只需刷新 DSH 页面（Cmd+R）
 * 即可生效，无需重启应用/插件。
 */
function toggleScriptTag() {
  try {
    const body = readFileSync(new URL('../toggle.js', import.meta.url), 'utf8')
    return `<script>\n${body}\n<\/script>`
  } catch {
    return ''
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {import('./chat.js').PetChatConfig} [config]
 */
export function apply(ctx, config = {}) {
  const service = new PetChatService(ctx, config)

  // 刷新端口桥：插件挂载时写一次（桥文件携带桌宠开关状态）。
  const writeBridge = () => writeBridgeFile(ctx.webServer.port)
  writeBridge()

  // 注册路由，随插件 fiber 自动卸载。
  const routes = makePetRoutes({ service, writeBridge, loadEnabled, saveEnabled })
  ctx.effect(
    () => {
      const disposers = routes.map((route) => ctx.webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    },
    'desktop-pet: routes',
  )

  // 往 DSH 界面 index.html 注入桌宠开关（插到 </body> 之前；随插件 fiber 自动卸载）。
  ctx.effect(
    () => ctx.webServer.tapIndex((html) => {
      const tag = toggleScriptTag()
      if (tag === '') return html
      return html.includes('</body>')
        ? html.replace('</body>', `${tag}\n</body>`)
        : html + tag
    }),
    'desktop-pet: gui-toggle',
  )

  ctx.on('dispose', () => {
    try {
      service.memory.save()
    } catch {
      // 落盘失败不影响退出
    }
  })
}
