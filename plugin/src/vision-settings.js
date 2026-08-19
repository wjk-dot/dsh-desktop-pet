/**
 * Local-only credentials for the optional Qwen vision MCP.
 * This file is deliberately separate from DSH profile YAML so a secret never
 * lands in a project, a profile patch, or the browser-visible config response.
 */

import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './dsh-home.js'

const CONFIG_FILE = 'pet-qwen-mm.env'

export function visionSettingsPath(dir = dshHome()) {
  return join(dir, CONFIG_FILE)
}

function parseConfig(text) {
  const values = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^(DASHSCOPE_API_KEY|QWEN_MM_API_VL_MODEL)=(.*)$/.exec(line)
    if (match) values[match[1]] = match[2]
  }
  return values
}

function readConfigFile(file) {
  try {
    return parseConfig(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

function readConfig(dir = dshHome()) {
  const configuredFile = process.env.QWEN_MM_CONFIG?.trim()
  const candidates = [
    configuredFile,
    visionSettingsPath(dir),
  ].filter(Boolean)
  for (const file of candidates) {
    if (!existsSync(file)) continue
    const values = readConfigFile(file)
    if (Object.keys(values).length > 0) return values
  }
  return {}
}

function effectiveConfig(dir = dshHome()) {
  const file = readConfig(dir)
  return {
    ...file,
    // Keep compatibility with users who configured Qwen before the plugin
    // settings card existed and exported the credentials in the host env.
    DASHSCOPE_API_KEY: file.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY || '',
    QWEN_MM_API_VL_MODEL: file.QWEN_MM_API_VL_MODEL || process.env.QWEN_MM_API_VL_MODEL || undefined,
  }
}
function validateSecret(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 512 || /[\r\n\0]/.test(value)) {
    throw new Error('invalid-dashscope-api-key')
  }
}

function validateModel(value) {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{2,100}$/.test(value)) throw new Error('invalid-qwen-vl-model')
  return value
}

/** Browser-safe view. The API key itself is intentionally never returned. */
export function visionSettingsView(dir = dshHome()) {
  const config = effectiveConfig(dir)
  const key = config.DASHSCOPE_API_KEY
  return {
    configured: typeof key === 'string' && key.length > 0,
    keySuffix: typeof key === 'string' && key.length >= 4 ? key.slice(-4) : null,
    model: config.QWEN_MM_API_VL_MODEL ?? null,
  }
}

/** Atomically persist settings with owner-only read/write permissions. */
export function saveVisionSettings({ apiKey, model }, dir = dshHome()) {
  validateSecret(apiKey)
  const selectedModel = validateModel(model)
  const lines = [`DASHSCOPE_API_KEY=${apiKey}`]
  if (selectedModel) lines.push(`QWEN_MM_API_VL_MODEL=${selectedModel}`)
  const file = visionSettingsPath(dir)
  const temp = `${file}.tmp`
  writeFileSync(temp, `${lines.join('\n')}\n`, { mode: 0o600 })
  chmodSync(temp, 0o600)
  renameSync(temp, file)
  return visionSettingsView(dir)
}
