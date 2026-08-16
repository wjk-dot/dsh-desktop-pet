/**
 * 桌宠对话记忆：滚动窗口 + $DSH_HOME/pet-chat.json 原子持久化。
 * v1 只做单会话滚动记忆（桌面宠物即一个会话），后续可扩展多会话。
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './dsh-home.js'

/** 默认保留最近对话轮数（1 轮 = 1 user + 1 assistant）。 */
export const DEFAULT_MAX_TURNS = 12

/** 记忆文件名（DSH home 下，与 dsh-pet 的 pet.json 并列）。 */
export const MEMORY_FILE = 'pet-chat.json'

/**
 * @typedef {Object} ChatMemoryEntry
 * @property {'user'|'assistant'} role
 * @property {string} content
 * @property {string} [at] ISO-8601 记录时间。
 */

/** 校验一条记忆条目是否可接受。 */
function validEntry(entry) {
  return (
    typeof entry === 'object' && entry !== null &&
    (entry.role === 'user' || entry.role === 'assistant') &&
    typeof entry.content === 'string' &&
    (entry.at === undefined || typeof entry.at === 'string')
  )
}

/**
 * 对话账本：完整持久化；模型调用单独读取最近窗口，避免上下文无限增长。
 */
export class PetMemory {
  /**
   * @param {string} [dir] DSH home 目录。
   * @param {number} [maxTurns] 保留轮数。
   */
  constructor(dir = dshHome(), maxTurns = DEFAULT_MAX_TURNS) {
    this.dir = dir
    this.maxTurns = maxTurns
    /** @type {ChatMemoryEntry[]} */
    this.entries = []
    this.load()
  }

  /** 从磁盘加载（首次运行静默容忍缺失）。 */
  load() {
    try {
      const raw = readFileSync(join(this.dir, MEMORY_FILE), 'utf8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed.history)) {
        this.entries = parsed.history.filter(validEntry)
      }
    } catch {
      // 首次运行：无文件或损坏则从空记忆开始
    }
  }

  /** 原子写入磁盘（临时文件 + rename）。 */
  save() {
    const file = join(this.dir, MEMORY_FILE)
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify({ history: this.entries }, null, 2), 'utf8')
    renameSync(tmp, file)
  }

  /**
   * 追加一条并持久化。完整历史用于桌面端工作区归档。
   * @param {ChatMemoryEntry} entry
   */
  push(entry) {
    this.entries.push({ role: entry.role, content: entry.content, ...(typeof entry.at === 'string' ? { at: entry.at } : {}) })
    this.save()
  }

  /** 清空记忆并持久化。 */
  clear() {
    this.entries = []
    this.save()
  }

  /** 当前记忆快照（顺序拷贝）。 */
  history() {
    return this.entries.slice()
  }

  /** 供 LLM 使用的滚动上下文窗口。 */
  contextHistory() {
    return this.entries.slice(-(this.maxTurns * 2))
  }
}
