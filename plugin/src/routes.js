/**
 * 桌宠 HTTP 路由族（host 半区）：
 * - POST /api/pet/chat    对话：SSE 流式回复
 * - GET  /api/pet/config  读取当前配置/模型/记忆轮数
 * - GET  /api/pet/history 读取会话记录（伴生应用启动时载入显示）
 * - POST /api/pet/memory  记忆操作：{action:'clear'}
 * - GET/POST /api/pet/control  桌宠开关（DSH 界面悬浮开关调用）
 * - POST /api/pet/bridge  重写端口发现桥文件（伴生应用连不上时可刷新）
 * - GET  /api/pet/health  健康检查（伴生应用离线轮询用）
 *
 * 通信模式与 dsh-pet 一致：插件自注册同源路由，伴生应用走 loopback 直连。
 */

import { json, readJsonBody, requireMethod } from './util.js'

/** SSE 单事件帧。 */
function sse(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

/**
 * 构造桌宠路由族。
 * @param {{service: import('./chat.js').PetChatService, writeBridge: () => string,
 *          loadEnabled: () => boolean, saveEnabled: (enabled: boolean) => void,
 *          companionApp: string, launchCompanion: (appPath: string) => boolean}} deps
 * @returns {import('@deepseek-ai/dsh-host-webserver').WebRoute[]}
 */
export function makePetRoutes({ service, writeBridge, loadEnabled, saveEnabled, companionApp, launchCompanion }) {
  return [
    {
      kind: 'exact',
      path: '/api/pet/health',
      handler: (req, res) => {
        if (!requireMethod(req, res, 'GET')) return
        json(res, 200, {
          ok: true,
          service: 'desktop-pet',
          port: req.socket?.localPort ?? null,
          enabled: loadEnabled(),
        })
      },
    },
    {
      kind: 'exact',
      path: '/api/pet/control',
      handler: (req, res) => {
        if (req.method === 'GET') {
          try {
            json(res, 200, { ok: true, enabled: loadEnabled() })
          } catch (error) {
            json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        if (!requireMethod(req, res, 'POST')) return
        readJsonBody(req).then(
          (body) => {
            if (typeof body.enabled !== 'boolean') {
              json(res, 400, { ok: false, error: 'invalid-enabled' })
              return
            }
            saveEnabled(body.enabled)
            writeBridge() // 桥文件携带新开关状态，伴生应用下一次轮询生效
            // 打开时立即拉起伴生应用（幂等）；关闭时伴生应用仍在运行，
            // 由其自行隐藏（进程与 DSH 生命周期绑定，DSH 退出时一起退）。
            if (body.enabled && companionApp) {
              launchCompanion(companionApp)
            }
            json(res, 200, { ok: true, enabled: body.enabled })
          },
          (error) => json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) }),
        )
      },
    },
    {
      kind: 'exact',
      path: '/api/pet/config',
      handler: (req, res) => {
        if (!requireMethod(req, res, 'GET')) return
        try {
          json(res, 200, { ok: true, config: service.configView() })
        } catch (error) {
          json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/pet/history',
      handler: async (req, res) => {
        if (!requireMethod(req, res, 'GET')) return
        try {
          const turns = await service.refreshHistory()
          json(res, 200, { ok: true, turns })
        } catch (error) {
          json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/pet/memory',
      handler: (req, res) => {
        if (!requireMethod(req, res, 'POST')) return
        readJsonBody(req).then(
          (body) => {
            if (body.action === 'clear') {
              service.clearMemory()
              json(res, 200, { ok: true, memoryTurns: 0 })
              return
            }
            json(res, 400, { ok: false, error: 'unknown-action' })
          },
          (error) => json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) }),
        )
      },
    },
    {
      kind: 'exact',
      path: '/api/pet/bridge',
      handler: (req, res) => {
        if (!requireMethod(req, res, 'POST')) return
        try {
          const file = writeBridge()
          json(res, 200, { ok: true, file })
        } catch (error) {
          json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/pet/chat',
      handler: (req, res) => {
        if (!requireMethod(req, res, 'POST')) return
        readJsonBody(req).then(
          (body) => {
            const message = typeof body.message === 'string' ? body.message : ''
            if (message.trim() === '') {
              json(res, 400, { ok: false, error: 'empty-message' })
              return
            }
            // SSE 流式响应
            res.writeHead(200, {
              'content-type': 'text/event-stream; charset=utf-8',
              'cache-control': 'no-cache',
              connection: 'keep-alive',
              'x-accel-buffering': 'no',
            })
            const abort = new AbortController()
            req.on('close', () => abort.abort())
            sse(res, { type: 'start' })
            ;(async () => {
              try {
                for await (const delta of service.streamChat(message, abort.signal)) {
                  sse(res, { type: 'delta', text: delta })
                }
                sse(res, { type: 'done' })
              } catch (error) {
                if (abort.signal.aborted) return // 客户端断开，不写错误帧
                sse(res, { type: 'error', error: error instanceof Error ? error.message : String(error) })
              } finally {
                res.end()
              }
            })()
          },
          (error) => json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) }),
        )
      },
    },
  ]
}
