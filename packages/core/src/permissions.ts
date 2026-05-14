// packages/core/src/permissions.ts
import picomatch from 'picomatch'
import path from 'node:path'
import { loadPermissionRules, type PermissionRule, type PermissionDecision } from './permission-rules.js'

export type { PermissionDecision } from './permission-rules.js'
export type PermissionMode = 'strict' | 'standard' | 'relaxed'
export type DangerLevel = 'dangerous' | 'critical'

export { type PermissionRule } from './permission-rules.js'

const READ_ONLY_TOOLS = new Set([
  'file_read', 'glob', 'grep', 'ls', 'tree',
  'task_create', 'task_get', 'task_list', 'task_update', 'task_stop',
  'todo_write', 'lsp', 'web_search', 'ask_user',
  'list_mcp_resources', 'read_mcp_resource', 'skill',
])

const WRITE_TOOLS = new Set([
  'bash', 'file_write', 'file_edit', 'notebook_edit', 'web_fetch', 'agent',
])

const CRITICAL_PATTERNS = [
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--force\s+)*(\/|~)\s*$/,
  /rm\s+-rf\s+(\/|~)\s*$/,
  /dd\s+if=/,
  /mkfs\./,
  /:(){ :\|:& };:/,
  />\s*\/dev\/sd/,
  /sudo\s+rm\s+-rf/,
]

const DANGEROUS_PATTERNS = [
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--force\s+)/,
  /rm\s+-rf/,
  /rm\s+-fr/,
  /git\s+push\s+--force/,
  /git\s+push\s+-f/,
  /git\s+reset\s+--hard/,
  /git\s+clean\s+-f/,
  /chmod\s+-R\s+777/,
  /curl\s+.*\|\s*(sh|bash)/,
  /wget\s+.*\|\s*(sh|bash)/,
  /docker\s+rm/,
  /docker\s+rmi/,
  /npm\s+publish/,
  /DROP\s+(TABLE|DATABASE)/i,
]

interface LoadedRules {
  projectRules: PermissionRule[]
  globalRules: PermissionRule[]
}

export class PermissionChecker {
  private mode: PermissionMode
  private cwd: string
  private projectRules: PermissionRule[]
  private globalRules: PermissionRule[]
  private sessionAllowed = new Set<string>()
  private deniedPatterns = new Map<string, Set<string>>()

  constructor(mode: PermissionMode = 'standard', cwd = '/', rules?: LoadedRules) {
    this.mode = mode
    this.cwd = cwd
    const loaded = rules || loadPermissionRules(cwd)
    this.projectRules = loaded.projectRules
    this.globalRules = loaded.globalRules
  }

  check(toolName: string, input: Record<string, unknown>): PermissionDecision {
    // Check denial tracking first
    if (this.isDenied(toolName, input)) {
      return 'deny'
    }

    // Session-level allows
    if (this.sessionAllowed.has(toolName)) {
      return 'allow'
    }

    // Critical commands always ask regardless of mode
    if (toolName === 'bash' && this.getDangerLevel(input) === 'critical') {
      return 'ask'
    }

    // Relaxed mode: allow everything (except critical, handled above)
    if (this.mode === 'relaxed') {
      return 'allow'
    }

    // Rule chain matching
    const decision = this.matchRuleChain(toolName, input)

    // Strict mode: downgrade allow to ask (except read-only tools)
    if (this.mode === 'strict' && decision === 'allow' && !READ_ONLY_TOOLS.has(toolName)) {
      return 'ask'
    }

    return decision
  }

  private matchRuleChain(toolName: string, input: Record<string, unknown>): PermissionDecision {
    // 1. Project rules (first match wins)
    const projectMatch = this.findMatch(this.projectRules, toolName, input)
    if (projectMatch) return projectMatch.decision

    // 2. Global rules (first match wins)
    const globalMatch = this.findMatch(this.globalRules, toolName, input)
    if (globalMatch) return globalMatch.decision

    // 3. If there are any rules for this tool (even if none matched),
    //    don't fall through to built-in defaults — return 'ask'
    if (this.hasRulesForTool(toolName)) return 'ask'

    // 4. Built-in defaults
    if (READ_ONLY_TOOLS.has(toolName)) return 'allow'
    if (WRITE_TOOLS.has(toolName)) return 'ask'

    // 5. Fallback
    return 'ask'
  }

  private hasRulesForTool(toolName: string): boolean {
    return this.projectRules.some(r => r.tool === toolName) ||
      this.globalRules.some(r => r.tool === toolName)
  }

  private findMatch(rules: PermissionRule[], toolName: string, input: Record<string, unknown>): PermissionRule | null {
    for (const rule of rules) {
      if (rule.tool !== toolName) continue

      // Rule with path pattern
      if (rule.path !== undefined) {
        const filePath = this.extractPath(input)
        if (!filePath) continue
        const relativePath = path.isAbsolute(filePath)
          ? path.relative(this.cwd, filePath)
          : filePath
        if (picomatch.isMatch(relativePath, rule.path)) {
          return rule
        }
        continue
      }

      // Rule with command pattern
      if (rule.command !== undefined) {
        const command = typeof input.command === 'string' ? input.command : ''
        if (!command) continue
        if (picomatch.isMatch(command, rule.command)) {
          return rule
        }
        continue
      }

      // Rule without path/command matches all invocations of this tool
      return rule
    }
    return null
  }

  private extractPath(input: Record<string, unknown>): string | null {
    if (typeof input.file_path === 'string') return input.file_path
    if (typeof input.path === 'string') return input.path
    return null
  }

  recordDenial(toolName: string, input: Record<string, unknown>): void {
    const key = this.getDenialKey(toolName, input)
    if (!this.deniedPatterns.has(toolName)) {
      this.deniedPatterns.set(toolName, new Set())
    }
    this.deniedPatterns.get(toolName)!.add(key)
  }

  private isDenied(toolName: string, input: Record<string, unknown>): boolean {
    const denied = this.deniedPatterns.get(toolName)
    if (!denied) return false
    const key = this.getDenialKey(toolName, input)
    return denied.has(key)
  }

  private getDenialKey(toolName: string, input: Record<string, unknown>): string {
    const filePath = this.extractPath(input)
    if (filePath) return filePath
    if (typeof input.command === 'string') return input.command
    return '*'
  }

  getDangerLevel(input: Record<string, unknown>): DangerLevel | null {
    const command = typeof input.command === 'string' ? input.command : ''
    if (!command) return null
    if (CRITICAL_PATTERNS.some(p => p.test(command))) return 'critical'
    if (DANGEROUS_PATTERNS.some(p => p.test(command))) return 'dangerous'
    return null
  }

  isDangerousCommand(input: Record<string, unknown>): boolean {
    return this.getDangerLevel(input) !== null
  }

  allowForSession(toolName: string): void {
    this.sessionAllowed.add(toolName)
  }

  getMode(): PermissionMode {
    return this.mode
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode
  }
}

export const DEFAULT_RULES: PermissionRule[] = [
  { tool: 'file_read', decision: 'allow' },
  { tool: 'glob', decision: 'allow' },
  { tool: 'grep', decision: 'allow' },
  { tool: 'ls', decision: 'allow' },
  { tool: 'tree', decision: 'allow' },
  { tool: 'bash', decision: 'ask' },
  { tool: 'file_write', decision: 'ask' },
  { tool: 'file_edit', decision: 'ask' },
]
