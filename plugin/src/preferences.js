/**
 * Desktop pet presentation preferences. Kept outside DSH's generic settings
 * transport so third-party plugins do not need to modify the host allowlist.
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './dsh-home.js'

export const PREFERENCES_FILE = 'pet-preferences.json'

export const DEFAULT_PREFERENCES = Object.freeze({
  iconSize: 120,
  showActivity: true,
  reduceMotion: false,
  autoDock: true,
})

export function preferencesFilePath(dir = dshHome()) {
  return join(dir, PREFERENCES_FILE)
}

function boolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/** Normalize untrusted route input and tolerate older or partial JSON files. */
export function normalizePreferences(value = {}) {
  const input = value && typeof value === 'object' ? value : {}
  const rawSize = Number(input.iconSize)
  return {
    iconSize: Number.isFinite(rawSize)
      ? Math.max(70, Math.min(200, Math.round(rawSize)))
      : DEFAULT_PREFERENCES.iconSize,
    showActivity: boolean(input.showActivity, DEFAULT_PREFERENCES.showActivity),
    reduceMotion: boolean(input.reduceMotion, DEFAULT_PREFERENCES.reduceMotion),
    autoDock: boolean(input.autoDock, DEFAULT_PREFERENCES.autoDock),
  }
}

export function loadPreferences(dir = dshHome()) {
  try {
    return normalizePreferences(JSON.parse(readFileSync(preferencesFilePath(dir), 'utf8')))
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

/** Atomic replacement prevents readers from ever observing truncated JSON. */
export function savePreferences(value, dir = dshHome()) {
  const preferences = normalizePreferences(value)
  const file = preferencesFilePath(dir)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(preferences, null, 2), 'utf8')
  renameSync(tmp, file)
  return preferences
}
