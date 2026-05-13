export type PermissionDecision = 'allow' | 'ask' | 'deny'
export type PermissionMode = 'strict' | 'standard' | 'relaxed'

export interface PermissionRule {
  tools: string[]
  decision: PermissionDecision
}

const READ_ONLY_TOOLS = [
  'file_read', 'glob', 'grep', 'ls', 'tree',
  'task_create', 'task_get', 'task_list', 'task_update', 'task_stop',
  'todo_write', 'lsp', 'web_search', 'ask_user',
]

const WRITE_TOOLS = [
  'bash', 'file_write', 'file_edit', 'notebook_edit', 'web_fetch',
]

const DANGEROUS_PATTERNS = [
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--force\s+).*\//,
  /rm\s+-rf/,
  /rm\s+-fr/,
  /git\s+push\s+--force/,
  /git\s+push\s+-f/,
  /git\s+reset\s+--hard/,
  /git\s+clean\s+-f/,
  /dd\s+if=/,
  /mkfs\./,
  /:(){ :\|:& };:/,
  />\s*\/dev\/sd/,
  /chmod\s+-R\s+777/,
  /sudo\s+rm/,
]

export const DEFAULT_RULES: PermissionRule[] = [
  { tools: READ_ONLY_TOOLS, decision: 'allow' },
  { tools: WRITE_TOOLS, decision: 'ask' },
]

export class PermissionChecker {
  private mode: PermissionMode
  private sessionAllowed: Set<string> = new Set()

  constructor(mode: PermissionMode = 'standard') {
    this.mode = mode
  }

  check(toolName: string, input: Record<string, unknown>): PermissionDecision {
    // Read-only tools are always allowed
    if (READ_ONLY_TOOLS.includes(toolName)) {
      return 'allow'
    }

    // Session-level overrides (only in standard/relaxed modes)
    if (this.mode !== 'strict' && this.sessionAllowed.has(toolName)) {
      return 'allow'
    }

    // Mode-specific logic
    switch (this.mode) {
      case 'strict':
        // Session allows still work in strict for explicitly allowed tools
        if (this.sessionAllowed.has(toolName)) {
          return 'allow'
        }
        return WRITE_TOOLS.includes(toolName) || !READ_ONLY_TOOLS.includes(toolName) ? 'ask' : 'allow'

      case 'relaxed':
        // In relaxed mode, only dangerous bash commands need confirmation
        if (toolName === 'bash' && this.isDangerousCommand(input)) {
          return 'ask'
        }
        return 'allow'

      case 'standard':
      default:
        if (WRITE_TOOLS.includes(toolName)) {
          return 'ask'
        }
        // Unknown tools default to ask
        return 'ask'
    }
  }

  allowForSession(toolName: string): void {
    this.sessionAllowed.add(toolName)
  }

  isDangerousCommand(input: Record<string, unknown>): boolean {
    const command = typeof input.command === 'string' ? input.command : ''
    if (!command) return false
    return DANGEROUS_PATTERNS.some(pattern => pattern.test(command))
  }

  getMode(): PermissionMode {
    return this.mode
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode
  }
}
