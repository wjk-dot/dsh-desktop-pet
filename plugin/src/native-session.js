/**
 * 桌宠和 DSH 左侧会话列表之间的原生桥。
 *
 * 不伪造 session.jsonl：通过 host 的 apiProxy 创建、命名、驱动真实 Agent
 * session，因此桌宠和 Harness UI 读写的是同一条对话。
 */

import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './dsh-home.js'

const STATE_FILE = 'pet-native-session.json'
const TITLE = '桌宠对话'

function textFromContent(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

function rpc(payload) {
  return { rpcId: `pet-${randomUUID()}`, payload }
}

function responseValue(response) {
  if (response?.result?.ok === true) return response.result.value
  const error = response?.result?.error
  throw new Error(error?.message ?? 'native-session-request-failed')
}

export class PetNativeSession {
  constructor(ctx, legacyHistory = []) {
    this.ctx = ctx
    this.stateFile = join(dshHome(), STATE_FILE)
    this.sessionId = undefined
    this.workspaceId = undefined
    this.waiters = []
    this.legacyHistory = legacyHistory
    this.eventDisposer = ctx.on('session/event', (session, event) => this.onEvent(session, event))
  }

  loadState() {
    try {
      const value = JSON.parse(readFileSync(this.stateFile, 'utf8'))
      if (typeof value.sessionId === 'string' && typeof value.workspaceId === 'string') return value
    } catch {
      // 首次运行或旧状态文件损坏：重新创建即可。
    }
    return undefined
  }

  saveState() {
    const file = `${this.stateFile}.tmp`
    writeFileSync(file, JSON.stringify({ sessionId: this.sessionId, workspaceId: this.workspaceId }, null, 2), 'utf8')
    renameSync(file, this.stateFile)
  }

  workspace() {
    const workspaces = this.ctx.workspaceRegistry.list()
    if (workspaces.length === 0) throw new Error('no-workspace-registered')
    return workspaces[0]
  }

  async ensure() {
    if (this.sessionId !== undefined) return this.sessionId

    const workspace = this.workspace()
    const saved = this.loadState()
    if (saved?.workspaceId === workspace.id) {
      try {
        responseValue(await this.ctx.apiProxy.sessions.create(rpc({ workspaceId: workspace.id, sessionId: saved.sessionId })))
        this.sessionId = saved.sessionId
        this.workspaceId = workspace.id
        return this.sessionId
      } catch {
        // 会话被删除或 cwd 已变化，下面创建新会话。
      }
    }

    const created = responseValue(await this.ctx.apiProxy.sessions.create(rpc({ workspaceId: workspace.id })))
    this.sessionId = created.sessionId
    this.workspaceId = workspace.id
    responseValue(await this.ctx.apiProxy.sessions.rename(rpc({ sessionId: this.sessionId, title: TITLE })))
    this.saveState()
    await this.importLegacyHistory()
    return this.sessionId
  }

  async importLegacyHistory() {
    if (this.legacyHistory.length === 0) return
    const transcript = this.legacyHistory
      .map((entry) => `${entry.role === 'user' ? '用户' : '小鲸鱼'}：${entry.content}`)
      .join('\n\n')
    const content = [
      '这是桌宠迁移到 DeepSeek Harness 原生会话前的历史记录。',
      '请将其作为后续对话上下文；只回复“已加载桌宠历史。”',
      '',
      transcript,
    ].join('\n')
    for await (const _ of this.promptInternal(content)) {
      // 历史导入的确认回复只留在原生会话，不在桌宠气泡重复播放。
    }
  }

  onEvent(session, event) {
    if (session.id !== this.sessionId) return
    for (const waiter of [...this.waiters]) waiter(event)
  }

  waitForTurn(rpcId, onText, signal) {
    let cancel = () => {}
    const promise = new Promise((resolve, reject) => {
      let started = false
      const remove = () => {
        const index = this.waiters.indexOf(listener)
        if (index >= 0) this.waiters.splice(index, 1)
        signal?.removeEventListener('abort', aborted)
      }
      const finish = (error) => {
        remove()
        if (error) reject(error)
        else resolve()
      }
      cancel = () => finish(new Error('cancelled'))
      const aborted = () => finish(new Error('aborted'))
      const listener = (event) => {
        if (event.type === 'user/message' && event.data?.source?.rpcId === rpcId) {
          started = true
          return
        }
        if (!started) return
        if (event.type === 'assistant/chunk') {
          const chunk = event.data?.chunk
          if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
            onText(chunk.text)
          }
        }
        if (event.type === 'turn/end') finish()
        if (event.type === 'turn/error') finish(new Error(event.data?.error?.message ?? 'agent-turn-failed'))
      }
      this.waiters.push(listener)
      signal?.addEventListener('abort', aborted, { once: true })
    })
    return { promise, cancel }
  }

  async *promptInternal(message, signal) {
    const sessionId = await this.ensure()
    let wake
    let closed = false
    const queue = []
    const push = (text) => {
      queue.push(text)
      wake?.()
    }
    const complete = () => {
      closed = true
      wake?.()
    }
    const request = rpc({
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: message }],
      clientTimeZone: 'Asia/Shanghai',
    })
    const waiter = this.waitForTurn(request.rpcId, push, signal)
    const turn = waiter.promise.then(complete, (error) => {
      closed = true
      wake?.()
      throw error
    })
    try {
      responseValue(await this.ctx.apiProxy.sessions.prompt(request))
      while (!closed || queue.length > 0) {
        if (queue.length === 0) await new Promise((resolve) => { wake = resolve })
        while (queue.length > 0) {
          const text = queue.shift()
          yield text
        }
      }
      await turn
    } finally {
      waiter.cancel()
      await turn.catch(() => {})
    }
  }

  async *prompt(message, signal) {
    yield * this.promptInternal(message, signal)
  }

  async history() {
    const sessionId = await this.ensure()
    const value = responseValue(await this.ctx.apiProxy.sessions.history(rpc({ sessionId, maxMessages: 200 })))
    return value.events.flatMap(({ event }) => {
      if (event.type === 'user/message' && event.data?.source?.kind === 'user') {
        return [{ role: 'user', content: textFromContent(event.data?.content), at: new Date(event.time).toISOString() }]
      }
      if (event.type === 'assistant/message') return [{ role: 'assistant', content: textFromContent(event.data?.message?.content), at: new Date(event.time).toISOString() }]
      return []
    }).filter((entry) => entry.content !== '')
  }

  dispose() {
    this.eventDisposer?.()
  }
}
