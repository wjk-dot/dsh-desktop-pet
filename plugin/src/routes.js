/**
 * 桌宠 HTTP 路由族（host 半区）：
 * - POST /api/pet/chat    对话：SSE 流式回复
 * - GET  /api/pet/config  读取当前配置/模型/记忆轮数
 * - GET  /api/pet/history 读取会话记录（伴生应用启动时载入显示）
 * - GET  /api/pet/status 读取原生 Agent 当前执行状态
 * - POST /api/pet/cancel 中止当前原生 Agent turn
 * - GET/POST /api/pet/control  桌宠开关（原生状态栏入口调用）
 * - POST /api/pet/bridge  重写端口发现桥文件（伴生应用连不上时可刷新）
 * - GET  /api/pet/health  健康检查（伴生应用离线轮询用）
 *
 * 通信模式与 dsh-pet 一致：插件自注册同源路由，伴生应用走 loopback 直连。
 */

import { json, readJsonBody, requireMethod } from './util.js'
import { launchCompanion } from './launch.js'

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
export function makePetRoutes({ service, writeBridge, loadEnabled, saveEnabled, companionApp, eventHub, instanceId }) {
  const validInstance = (req, res) => {
    const supplied = req.headers['x-pet-instance']
    if (supplied === undefined || supplied === instanceId) return true
    json(res, 409, { ok: false, error: 'stale-pet-instance' })
    return false
  }
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
          instanceId,
        })
      },
    },
    {
      kind: 'exact',
      path: '/api/pet/events',
      handler: (req, res) => {
        if (!requireMethod(req, res, 'GET')) return
        if (!validInstance(req, res)) return
        const requestUrl = new URL(req.url ?? '/api/pet/events', 'http://127.0.0.1')
        const after = Math.max(0, Number.parseInt(requestUrl.searchParams.get('after') ?? '0', 10) || 0)
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        })
        const send = (event) => res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`)
        res.write(`event: ready\ndata: ${JSON.stringify({ instanceId, seq: eventHub.sequence })}\n\n`)
        for (const event of eventHub.replay(after)) send(event)
        const unsubscribe = eventHub.subscribe(send)
        const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 10_000)
        req.on('close', () => {
          clearInterval(heartbeat)
          unsubscribe()
        })
      },
    },
    {
      kind: 'exact',
      path: '/api/pet/control',
      handler: (req, res) => {
        if (!validInstance(req, res)) return
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
            eventHub.publish('control', { enabled: body.enabled })
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
        if (!validInstance(req, res)) return
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
        if (!validInstance(req, res)) return
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
      path: '/api/pet/status',
      handler: async (req, res) => {
        if (!validInstance(req, res)) return
        if (!requireMethod(req, res, 'GET')) return
        try {
          json(res, 200, { ok: true, status: await service.statusView() })
        } catch (error) {
          json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/pet/cancel',
      handler: async (req, res) => {
        if (!validInstance(req, res)) return
        if (!requireMethod(req, res, 'POST')) return
        try {
          json(res, 200, { ok: true, result: await service.cancelTurn() })
        } catch (error) {
          json(res, 409, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/pet/bridge',
      handler: (req, res) => {
        if (!validInstance(req, res)) return
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
        if (!validInstance(req, res)) return
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
                for await (const event of service.streamChat(message, abort.signal)) {
                  if (event.type === 'delta') sse(res, { type: 'delta', text: event.text })
                  else if (event.type === 'activity') sse(res, { type: 'activity', activity: event.activity })
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
