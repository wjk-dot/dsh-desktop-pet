/**
 * 端口发现桥：把 host 的监听端口写入 $DSH_HOME/pet-bridge.json，
 * 伴生应用（Swift 桌宠窗口）读取该文件即可找到对话端点，无需知道固定端口。
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './dsh-home.js'

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
export function writeBridgeFile(port, dir = dshHome()) {
  const data = {
    port,
    pid: process.pid,
    version: packageVersion(),
    startedAt: Date.now(),
    home: dir,
  }
  const file = bridgeFilePath(dir)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, file)
  return file
}

/**
 * 读取桥文件（不存在或损坏返回 null）。
 * @param {string} [dir] DSH home。
 * @returns {{port: number, pid?: number, version?: string, startedAt?: number}|null}
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
