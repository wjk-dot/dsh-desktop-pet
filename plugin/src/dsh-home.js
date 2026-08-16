/**
 * DSH_HOME 解析：环境变量优先，平台家目录兜底。
 * 与 dsh-pet / dsh-liangshen 家族保持同一套语义。
 */

import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/** 展开路径开头的 ~（或 ~user）。 */
export function expandHome(path, home = homedir()) {
  if (path === '~') return home
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(home, path.slice(2))
  return path
}

/**
 * 解析 DSH home 目录。
 * @param {NodeJS.ProcessEnv} env 读取 DSH_HOME 的环境对象（测试注入点）。
 * @param {string} home 平台家目录兜底（测试注入点）。
 * @returns {string} DSH home 绝对路径。
 */
export function resolveDshHome(env = process.env, home = homedir()) {
  const raw = env.DSH_HOME
  if (raw !== undefined && raw.trim() !== '') {
    const expanded = expandHome(raw.trim(), home)
    return isAbsolute(expanded) ? expanded : join(process.cwd(), expanded)
  }
  return join(home, '.dsh')
}

/** 从当前进程环境解析 DSH home。 */
export function dshHome() {
  return resolveDshHome()
}
