/**
 * 将桌宠对话镜像为每个已注册 DSH 工作区根目录下的 Markdown 文件。
 * 桌宠走轻量 LLM 流，不能安全地往 Agent 会话日志中硬塞已生成的回复；
 * 工作区文件能被桌面端 Files 面板直接展示。
 */

import { renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const WORKSPACE_HISTORY_FILE = '桌宠对话记录.md'

function formatTime(value) {
  if (typeof value !== 'string') return '历史记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '历史记录' : date.toLocaleString('zh-CN', { hour12: false })
}

function render(entries) {
  const lines = [
    '# 桌宠对话记录',
    '',
    '> 此文件由 DeepSeek 桌宠自动同步。桌宠的滚动上下文可能会截断，本文保留同步到工作区后的完整记录。',
    '',
  ]

  for (const entry of entries) {
    const speaker = entry.role === 'user' ? '你' : '小鲸鱼'
    lines.push(`## ${formatTime(entry.at)} · ${speaker}`, '', entry.content, '')
  }

  return `${lines.join('\n')}\n`
}

/** 每次完整对话后写入快照，避免流式中断留下半轮记录。 */
export class WorkspaceHistoryMirror {
  constructor(workspaceRegistry) {
    this.workspaceRegistry = workspaceRegistry
  }

  sync(entries) {
    const document = render(entries)
    for (const workspace of this.workspaceRegistry.list()) {
      try {
        const file = join(workspace.path, WORKSPACE_HISTORY_FILE)
        const temporary = `${file}.tmp`
        writeFileSync(temporary, document, 'utf8')
        renameSync(temporary, file)
      } catch (error) {
        console.warn(`desktop-pet: failed to sync workspace history for ${workspace.path}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
