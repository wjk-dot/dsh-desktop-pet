/**
 * 桌宠伴生应用拉起：路径解析 + 幂等启动（open）。
 * 独立模块供 index.js 与 routes.js 共用（避免循环依赖）。
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Resolve the companion without assuming the host is running on macOS.
 * DSH_PET_COMPANION is the deterministic override for packaged installs.
 */
export function defaultCompanionApp() {
  try {
    const override = process.env.DSH_PET_COMPANION?.trim()
    if (override && existsSync(override)) return override

    if (process.platform === 'darwin') {
      // This file is <repo>/plugin/src/launch.js.
      const cand = new URL('../../companion/build/DeepSeekPet.app', import.meta.url)
      return existsSync(cand) ? fileURLToPath(cand) : ''
    }

    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || ''
      const programFiles = process.env.ProgramFiles || ''
      const programFilesX86 = process.env['ProgramFiles(x86)'] || ''
      const programW6432 = process.env.ProgramW6432 || ''
      const candidates = [
        join(localAppData, 'DeepSeekPet', 'DeepSeekPet.exe'),
        join(localAppData, 'Programs', 'DeepSeekPet', 'DeepSeekPet.exe'),
        join(localAppData, 'Programs', 'DeepSeek Pet', 'DeepSeekPet.exe'),
        join(programFiles, 'DeepSeekPet', 'DeepSeekPet.exe'),
        join(programFiles, 'DeepSeek Pet', 'DeepSeekPet.exe'),
        join(programFilesX86, 'DeepSeekPet', 'DeepSeekPet.exe'),
        join(programFilesX86, 'DeepSeek Pet', 'DeepSeekPet.exe'),
        join(programW6432, 'DeepSeekPet', 'DeepSeekPet.exe'),
        join(programW6432, 'DeepSeek Pet', 'DeepSeekPet.exe'),
      ]

      // Keep a checkout usable before an installer has been produced. The
      // release artifact is ignored by git, so this only activates when a
      // local developer build is actually present.
      const checkoutRelease = fileURLToPath(new URL(
        '../../companions/windows/src-tauri/target/release/deepseek-pet-windows.exe',
        import.meta.url,
      ))
      candidates.push(checkoutRelease)
      return candidates.find((candidate) => existsSync(candidate)) || ''
    }

    return ''
  } catch {
    return ''
  }
}

/** Idempotently launch the companion on the current platform. */
export function launchCompanion(appPath) {
  if (!appPath) {
    console.error('[desktop-pet] launchCompanion: 空路径，跳过')
    return false
  }
  try {
    if (process.platform === 'darwin') {
      spawn('open', [appPath], { stdio: 'ignore', detached: true }).unref()
    } else {
      // Windows installers expose the executable directly. `detached` keeps
      // the pet alive after the DSH host command returns.
      spawn(appPath, [], { stdio: 'ignore', detached: true, windowsHide: true }).unref()
    }
    console.error(`[desktop-pet] launchCompanion: started ${appPath}`)
    return true
  } catch (error) {
    console.error(`[desktop-pet] launchCompanion 失败: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}
