/**
 * PetChatService：桌宠对话核心。
 * 直接走官方 `ctx.llm.stream()`（与自动会话标题同一通道），
 * 不经过完整 agent 循环——快、省、符合「简单对话」定位。
 * 模型默认跟随全局 agent-default-model 选择，可独立覆盖。
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
  constructor(ctx, config = {}) {
    this.ctx = ctx
    this.config = {
      personaName: '小鲸鱼',
      maxHistoryTurns: 12,
      ...config,
    }
    this.memory = new PetMemory(dshHome(), this.config.maxHistoryTurns)
    this.nativeSession = new PetNativeSession(ctx, this.memory.history())
  }

  /** 当前系统提示词。 */
  systemPrompt() {
    return this.config.systemPrompt ?? buildPersona(this.config.personaName)
  }

  /**
   * 流式对话：把用户消息送入 LLM，逐字 yield 回复文本。
   * 完成后把 (user, assistant) 追加进滚动记忆并持久化。
   *
   * @param {string} message 用户消息。
   * @param {AbortSignal} [signal] 客户端断开/超时取消。
   * @yields {string} 回复文本增量。
   */
  async *streamChat(message, signal) {
    if (typeof message !== 'string' || message.trim() === '') {
      throw new Error('empty-message')
    }
    const messageText = message.trim()

    let reply = ''
    for await (const text of this.nativeSession.prompt(messageText, signal)) {
      reply += text
      yield text
    }

    const history = await this.nativeSession.history()
    this.memory.entries = history
    this.memory.save()
  }

  /** 清空对话记忆。 */
  clearMemory() {
    this.memory.clear()
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
