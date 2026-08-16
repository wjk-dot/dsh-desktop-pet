/**
 * 桌宠开关状态：$DSH_HOME/pet-desktop.json 持久化（默认开启）。
 * DSH 界面注入的悬浮开关与伴生应用都以此为唯一事实来源。
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './dsh-home.js'

/** 控制文件（DSH home 下）。 */
export const CONTROL_FILE = 'pet-desktop.json'

/**
 * 控制文件路径。
 * @param {string} [dir] DSH home。
 * @returns {string}
 */
export function controlFilePath(dir = dshHome()) {
  return join(dir, CONTROL_FILE)
}

/** 读取桌宠开关（默认开启；文件缺失/损坏按开启处理）。 */
export function loadEnabled(dir = dshHome()) {
  try {
    const raw = readFileSync(controlFilePath(dir), 'utf8')
    const parsed = JSON.parse(raw)
    if (typeof parsed.enabled === 'boolean') return parsed.enabled
    return true
  } catch {
    return true
  }
}

/** 写入桌宠开关（原子写）。 */
export function saveEnabled(enabled, dir = dshHome()) {
  const file = controlFilePath(dir)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify({ enabled: !!enabled }, null, 2), 'utf8')
  renameSync(tmp, file)
}
