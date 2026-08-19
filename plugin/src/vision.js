/**
 * User-triggered screenshot intake for the optional Qwen visual toolchain.
 * DSH promotes the same bytes to its durable session attachment store; the
 * short-lived local copy only gives an MCP process a filesystem input path.
 */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { dshHome } from './dsh-home.js'
import { visionSettingsView } from './vision-settings.js'

const MAX_CAPTURE_BYTES = 6 * 1024 * 1024
const CAPTURE_TTL_MS = 30 * 60 * 1000
const CAPTURE_DIR = 'pet-vision-captures'

function validBase64(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(value)
}

function qwenConfigPresent() {
  return visionSettingsView().configured
}

function commandAvailable(command) {
  // Apps launched by Finder or the Windows shell may omit user-local bins from
  // PATH even though the MCP's explicit command can resolve them.
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const localAppData = process.env.LOCALAPPDATA || ''
  const appData = process.env.APPDATA || ''
  const directories = [
    ...(process.env.PATH ?? '').split(delimiter),
    join(home, '.local', 'bin'),
    join(localAppData, 'Programs', 'Python'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ].filter(Boolean)
  if (process.platform === 'win32' && appData) {
    try {
      for (const entry of readdirSync(join(appData, 'Python'), { withFileTypes: true })) {
        if (entry.isDirectory() && /^Python\d+$/i.test(entry.name)) {
          directories.push(join(appData, 'Python', entry.name, 'Scripts'))
        }
      }
    } catch {
      // The user-local Python directory is optional; PATH remains authoritative.
    }
  }
  const names = process.platform === 'win32'
    ? [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`]
    : [command]
  return directories.some((dir) => names.some((name) => existsSync(join(dir, name))))
}

export function visionStatus(preferences) {
  const configured = qwenConfigPresent()
  const uvxAvailable = commandAvailable('uvx')
  return {
    enabled: preferences.visionEnabled,
    qwenConfigured: configured,
    credentials: visionSettingsView(),
    uvxAvailable,
    // The profile owns MCP registration. This is only a local preflight, not
    // proof that a restarted DSH host has successfully launched the server.
    preflightReady: preferences.visionEnabled && configured && uvxAvailable,
    captureRetentionMinutes: CAPTURE_TTL_MS / 60_000,
  }
}

async function cleanExpiredCaptures(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const now = Date.now()
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile()) return
      const timestamp = Number.parseInt(entry.name.split('-')[0], 10)
      if (!Number.isFinite(timestamp) || now - timestamp > CAPTURE_TTL_MS) {
        await rm(join(dir, entry.name), { force: true })
      }
    }))
  } catch {
    // The new capture is still useful even when old-file cleanup fails.
  }
}

/** Validate and retain a JPEG only long enough for the local MCP tool to read it. */
export async function saveVisionCapture(base64, name = 'desktop-screenshot.jpg') {
  if (!validBase64(base64)) throw new Error('invalid-image-data')
  const data = Buffer.from(base64, 'base64')
  if (data.length === 0 || data.length > MAX_CAPTURE_BYTES) throw new Error('image-too-large')
  // JPEG SOI marker catches accidental JSON/text uploads before host admission.
  if (data[0] !== 0xff || data[1] !== 0xd8) throw new Error('unsupported-image-type')
  const dir = join(dshHome(), CAPTURE_DIR)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await cleanExpiredCaptures(dir)
  const file = join(dir, `${Date.now()}-${randomUUID()}.jpg`)
  await writeFile(file, data, { mode: 0o600 })
  return { data, name: name.replace(/[\\/]/g, '_').slice(0, 120) || 'desktop-screenshot.jpg', file }
}

export function visionPrompt(userPrompt, capturePath, ready) {
  const request = typeof userPrompt === 'string' && userPrompt.trim()
    ? userPrompt.trim()
    : '请分析这张屏幕截图，概括当前界面、关键信息和下一步可操作项。'
  const qwenInstruction = ready
    ? [
      '必须先调用已安装的 qwen-mm-plugins-api 视觉工具（优先 vision_chat；需要文字时用 ocr），并把这个本地截图路径作为图片输入。',
      '不得仅根据本条文字、文件名或已有对话猜测截图内容。若工具调用失败，原样说明工具错误和下一步配置，不要编造分析结果。',
    ].join('\n')
    : 'Qwen 视觉 MCP 尚未就绪。请在回复中明确说明需要在桌宠插件设置中完成视觉配置；不要臆测截图内容。'
  return [
    '这是用户主动从桌宠提交的桌面截图。当前 DeepSeek Agent 模型仅支持文本，因此图片保存在本机路径供 Qwen MCP 读取；本条 Agent turn 不包含图片附件。',
    qwenInstruction,
    `临时图片路径（仅保留 30 分钟）：${capturePath}`,
    `用户请求：${request}`,
  ].join('\n')
}
