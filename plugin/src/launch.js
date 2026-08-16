/**
 * 桌宠伴生应用拉起：路径解析 + 幂等启动（open）。
 * 独立模块供 index.js 与 routes.js 共用（避免循环依赖）。
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 桌宠伴生应用默认路径：插件所在仓库的 companion/build/DeepSeekPet.app。 */
export function defaultCompanionApp() {
  try {
    // 本文件位于 <repo>/plugin/src/launch.js，需上溯两级到仓库根再进 companion/
    const cand = new URL('../../companion/build/DeepSeekPet.app', import.meta.url)
    return existsSync(cand) ? fileURLToPath(cand) : ''
  } catch {
    return ''
  }
}

/** 幂等拉起伴生应用（open 对已运行实例只是激活，不会重复启动）。 */
export function launchCompanion(appPath) {
  if (!appPath) {
    console.error('[desktop-pet] launchCompanion: 空路径，跳过')
    return false
  }
  try {
    spawn('open', [appPath], { stdio: 'ignore', detached: true }).unref()
    console.error(`[desktop-pet] launchCompanion: 已执行 open ${appPath}`)
    return true
  } catch (error) {
    console.error(`[desktop-pet] launchCompanion 失败: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}
