/**
 * PetChatService：桌宠对话核心。
 * 直接走官方 `ctx.llm.stream()`（与自动会话标题同一通道），
 * 不经过完整 agent 循环——快、省、符合「简单对话」定位。
 * 模型默认跟随全局 agent-default-model 选择，可独立覆盖。
 */

import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { dshHome } from './dsh-home.js'
import { PetMemory } from './memory.js'
import { buildPersona } from './persona.js'

/** 纯文本内容块。 */
function textBlock(text) {
  return { type: 'text', text }
}

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
 * 桌宠对话服务：组装消息 → llm.stream → 逐字产出；结束后更新记忆。
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

    // 模型选择：配置覆盖 > 全局 agent-default-model
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const provider = this.config.model?.provider ?? selection.provider
    const model = this.config.model?.model ?? selection.model
    const reasoningEffort = this.config.model?.reasoningEffort ?? selection.reasoningEffort

    // 组装消息：滚动历史 + 本次提问
    const messages = [
      ...this.memory.history().map((m) =>
        m.role === 'user'
          ? createUserMessage({ content: [textBlock(m.content)], source: { kind: 'user' } })
          : createAssistantMessage({ content: [textBlock(m.content)], source: { provider, model } }),
      ),
      createUserMessage({ content: [textBlock(messageText)], source: { kind: 'user' } }),
    ]

    const options = {
      provider,
      model,
      system: this.systemPrompt(),
      messages,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      signal,
    }
    if (reasoningEffort !== undefined) options.reasoningEffort = reasoningEffort

    let reply = ''
    try {
      const stream = this.ctx.llm.stream(options)
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') {
          reply += chunk.text
          yield chunk.text
        } else if (chunk.type === 'finish') {
          break
        }
      }
    } catch (error) {
      // 记忆只记完整轮次：LLM 调用失败不入记忆
      throw error
    }

    this.memory.push({ role: 'user', content: messageText })
    this.memory.push({ role: 'assistant', content: reply || '（无回复）' })
  }

  /** 清空对话记忆。 */
  clearMemory() {
    this.memory.clear()
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
}
