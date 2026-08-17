/**
 * 端口发现桥：把 host 的监听端口写入 $DSH_HOME/pet-bridge.json，
 * 伴生应用（Swift 桌宠窗口）读取该文件即可找到对话端点，无需知道固定端口。
 * 桥文件同时携带桌宠开关（enabled），伴生应用据此隐藏/显示自己。
 */

import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './dsh-home.js'
import { loadEnabled } from './control.js'

/** 桥文件名。 */
export const BRIDGE_FILE = 'pet-bridge.json'

/** 自身 package.json 的 version（跟随发布版本）。 */
function packageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/**
 * 桥文件路径。
 * @param {string} [dir] DSH home。
 * @returns {string}
 */
export function bridgeFilePath(dir = dshHome()) {
  return join(dir, BRIDGE_FILE)
}

/**
 * 写入桥文件（原子写）。
 * @param {number} port host web 服务器监听端口。
 * @param {string} [dir] DSH home。
 * @returns {string} 桥文件路径。
 */
export function writeBridgeFile(port, { dir = dshHome(), instanceId, leaseMs = 15_000 } = {}) {
  if (typeof instanceId !== 'string' || instanceId === '') throw new Error('missing-bridge-instance-id')
  const now = Date.now()
  const data = {
    port,
    pid: process.pid,
    instanceId,
    version: packageVersion(),
    startedAt: now,
    expiresAt: now + leaseMs,
    home: dir,
    enabled: loadEnabled(dir),
  }
  const file = bridgeFilePath(dir)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, file)
  return file
}

/** Remove a bridge only when it is still owned by this runtime. */
export function removeBridgeFile(instanceId, dir = dshHome()) {
  const current = readBridgeFile(dir)
  if (current?.instanceId !== instanceId) return false
  try {
    unlinkSync(bridgeFilePath(dir))
    return true
  } catch {
    return false
  }
}

/**
 * 读取桥文件（不存在或损坏返回 null）。
 * @param {string} [dir] DSH home。
 * @returns {{port: number, pid?: number, version?: string, startedAt?: number, enabled?: boolean}|null}
 */
export function readBridgeFile(dir = dshHome()) {
  try {
    const raw = readFileSync(bridgeFilePath(dir), 'utf8')
    const parsed = JSON.parse(raw)
    if (typeof parsed.port === 'number' && Number.isInteger(parsed.port) && parsed.port > 0) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}
