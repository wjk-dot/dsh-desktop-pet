/**
 * PetChatService：桌宠对话核心。
 * 通过官方 apiProxy 驱动同一条原生 Agent session，而非另开轻量 LLM 对话。
 */

import { dshHome } from './dsh-home.js'
import { PetMemory } from './memory.js'
import { PetNativeSession } from './native-session.js'
import { buildPersona } from './persona.js'

/**
 * @typedef {Object} PetChatConfig
 * @property {string} [personaName] 桌宠名字（人格 prompt 用）。
 * @property {string} [systemPrompt] 完整系统提示词，覆盖默认人格。
 * @property {number} [maxHistoryTurns] 保留对话轮数，默认 12。
 * @property {number} [temperature] 采样温度。
 * @property {number} [maxTokens] 单次回复最大 token。
 * @property {{provider?: string, model?: string, reasoningEffort?: string}} [model] 模型覆盖。
 */

/**
 * 桌宠对话服务：通过原生 DSH Agent session 对话；左栏/UI/桌宠共用同一记录。
 */
export class PetChatService {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx
   * @param {PetChatConfig} [config]
   */
  constructor(ctx, config = {}, eventHub) {
    this.ctx = ctx
    this.config = {
      personaName: '小鲸鱼',
      maxHistoryTurns: 12,
      ...config,
    }
    this.memory = new PetMemory(dshHome(), this.config.maxHistoryTurns)
    this.eventHub = eventHub
    this.nativeSession = new PetNativeSession(ctx, this.memory.history(), (event, status) => {
      this.eventHub?.publish('session', { event, status })
    })
  }

  /** 当前系统提示词。 */
  systemPrompt() {
    return this.config.systemPrompt ?? buildPersona(this.config.personaName)
  }

  /**
 * 流式对话：把用户消息送进 Harness 原生 Agent，而不是另起一个 LLM 通道。
 * 因此工具调用、Full access、工作区和会话日志与桌面端完全共用。
   *
   * @param {string} message 用户消息。
   * @param {AbortSignal} [signal] 客户端断开/超时取消。
   * @yields {{type: 'delta', text: string} | {type: 'activity', activity: object}} 事件。
   */
  async *streamChat(message, signal) {
    if (typeof message !== 'string' || message.trim() === '') {
      throw new Error('empty-message')
    }
    const messageText = message.trim()

    let reply = ''
    for await (const event of this.nativeSession.prompt(messageText, signal)) {
      if (event.type === 'activity') {
        yield event
        continue
      }
      reply += event.text
      yield event
    }

    const history = await this.nativeSession.history()
    this.memory.entries = history
    this.memory.save()
  }

  /** 当前会话记录（供 /api/pet/history 读取，伴生应用启动时载入显示）。 */
  historyView() {
    return this.memory.history().map((m) => ({ role: m.role, content: m.content, ...(m.at === undefined ? {} : { at: m.at }) }))
  }

  async refreshHistory() {
    const history = await this.nativeSession.history()
    this.memory.entries = history
    this.memory.save()
    return history
  }

  async statusView() {
    return this.nativeSession.status()
  }

  async cancelTurn() {
    return this.nativeSession.cancel()
  }

  /** 当前配置视图（供 /api/pet/config 读取）。 */
  configView() {
    const selection = this.ctx.agentDefaultModel.currentSelection()
    return {
      personaName: this.config.personaName,
      maxHistoryTurns: this.config.maxHistoryTurns,
      model: {
        provider: this.config.model?.provider ?? selection.provider,
        model: this.config.model?.model ?? selection.model,
        reasoningEffort: this.config.model?.reasoningEffort ?? selection.reasoningEffort ?? null,
      },
      memoryTurns: Math.floor(this.memory.history().length / 2),
    }
  }

  dispose() {
    this.nativeSession.dispose()
  }
}
