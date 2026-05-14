import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

export type PermissionDecision = 'allow' | 'ask' | 'deny'

export interface PermissionRule {
  tool: string
  path?: string
  command?: string
  decision: PermissionDecision
}

interface PermissionRuleFile {
  rules: PermissionRule[]
}

export function loadPermissionRules(
  cwd: string,
  globalConfigDir?: string
): { projectRules: PermissionRule[]; globalRules: PermissionRule[] } {
  const configDir = globalConfigDir || path.join(
    process.env.HOME || process.env.USERPROFILE || '',
    '.jdcagnet'
  )

  const projectPath = path.join(cwd, '.jdcagnet', 'permissions.json')
  const globalPath = path.join(configDir, 'permissions.json')

  return {
    projectRules: loadRuleFile(projectPath),
    globalRules: loadRuleFile(globalPath),
  }
}

function loadRuleFile(filePath: string): PermissionRule[] {
  if (!existsSync(filePath)) return []
  try {
    const content = readFileSync(filePath, 'utf-8')
    const parsed: PermissionRuleFile = JSON.parse(content)
    if (!Array.isArray(parsed.rules)) return []
    return parsed.rules.filter(
      r => r && typeof r.tool === 'string' && typeof r.decision === 'string'
    )
  } catch {
    return []
  }
}
