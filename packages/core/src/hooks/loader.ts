import { readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { HookConfigSchema, type HookConfig, type HookRule, type HookEvent } from './types.js'

const GLOBAL_PATH = path.join(os.homedir(), '.jdcagnet', 'hooks.json')

function projectPath(cwd: string): string {
  return path.join(cwd, '.jdcagnet', 'hooks.json')
}

async function loadFile(filePath: string): Promise<HookConfig | null> {
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf-8'))
    return HookConfigSchema.parse(raw)
  } catch {
    return null
  }
}

export async function loadHookConfig(cwd: string): Promise<HookConfig> {
  const global = await loadFile(GLOBAL_PATH)
  const project = await loadFile(projectPath(cwd))
  return mergeConfigs(global, project)
}

function mergeConfigs(global: HookConfig | null, project: HookConfig | null): HookConfig {
  if (!global && !project) return { hooks: {} }
  if (!global) return project!
  if (!project) return global

  const events: HookEvent[] = ['PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd']
  const merged: HookConfig = { hooks: {} }
  for (const event of events) {
    const g = global.hooks[event] || []
    const p = project.hooks[event] || []
    if (g.length || p.length) {
      merged.hooks[event] = [...g, ...p]
    }
  }
  return merged
}

export function getMatchingHooks(config: HookConfig, event: HookEvent, toolName?: string): HookRule[] {
  const rules = config.hooks[event] || []
  if (!toolName) return rules
  return rules.filter((r) => {
    if (!r.matcher) return true
    if (r.matcher === '*') return true
    if (r.matcher.endsWith('*')) return toolName.startsWith(r.matcher.slice(0, -1))
    return r.matcher === toolName
  })
}
