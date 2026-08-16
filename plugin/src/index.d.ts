/**
 * dsh-desktop-pet 类型声明（供 TS 消费者使用；运行时为纯 ESM JS）。
 */

/** 插件配置。 */
export interface PetChatConfig {
  /** 桌宠名字（人格 prompt 用），默认「小鲸鱼」。 */
  personaName?: string
  /** 完整系统提示词，覆盖默认人格。 */
  systemPrompt?: string
  /** 保留对话轮数，默认 12。 */
  maxHistoryTurns?: number
  /** 采样温度。 */
  temperature?: number
  /** 单次回复最大 token。 */
  maxTokens?: number
  /** 模型覆盖（默认跟随全局 agent-default-model）。 */
  model?: {
    provider?: string
    model?: string
    reasoningEffort?: string
  }
}

/** 插件入口（cordis apply）。 */
export declare function apply(
  ctx: import('@deepseek-ai/cordis').Context,
  config?: PetChatConfig,
): void

/** 稳定插件名。 */
export declare const name: 'desktop-pet'

/** 依赖服务。 */
export declare const inject: string[]
