import path from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export const PLAN_MODE_ALLOWED_TOOLS = [
  'Read', 'Glob', 'Grep', 'LS', 'Tree', 'LSP',
  'Bash', 'Edit', 'Write', 'NotebookEdit',
  'Agent', 'Skill',
  'EnterPlanMode', 'ExitPlanMode',
  'AskUserQuestion',
  'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate',
  'BackgroundStatus', 'BackgroundEvents', 'team_list',
  'WebSearch', 'WebFetch',
]

// Tools that are allowed to write only to plan files
const PLAN_FILE_WRITE_TOOLS = ['Write', 'Edit', 'NotebookEdit']

function isPlanFilePath(filePath: string, cwd: string): boolean {
  const resolved = path.resolve(cwd, filePath)
  const planDir = path.resolve(cwd, '.jdcagnet', 'plans')
  return resolved.startsWith(planDir + path.sep) || resolved.startsWith(planDir + '/')
}

export function isPlanModeToolAllowed(
  toolName: string,
  input: Record<string, unknown>,
  cwd?: string
): boolean {
  // MCP tools (mcp__*) are read-only queries, allow them
  if (toolName.startsWith('mcp__')) return true

  if (!PLAN_MODE_ALLOWED_TOOLS.includes(toolName)) return false

  // Write/Edit/NotebookEdit: only allow targeting plan files
  if (PLAN_FILE_WRITE_TOOLS.includes(toolName)) {
    const filePath = (input.file_path || input.path || input.notebook_path || '') as string
    if (!filePath || !cwd) return false
    return isPlanFilePath(filePath, cwd)
  }

  // Bash: allow all commands (read-only queries like grep, find, git log, etc.)
  // The model is instructed not to make destructive changes; this gate
  // doesn't need to duplicate that — blocking Bash entirely prevents
  // useful exploration during planning.
  if (toolName === 'Bash') return true

  return true
}

export type PlanModeCallback = () => void

export function createEnterPlanModeTool(onEnter: PlanModeCallback): ToolHandler {
  return {
    definition: {
      name: 'EnterPlanMode',
      description:
        'Enter plan mode to design an implementation approach before writing code. ' +
        'Use proactively when: (1) new feature implementation, (2) multiple valid approaches exist, ' +
        '(3) changes affect existing behavior/structure, (4) architectural decisions, (5) multi-file changes (>2-3 files), ' +
        '(6) unclear requirements needing exploration first. ' +
        'Do NOT use for: single-line fixes, adding a single function with clear requirements, ' +
        'user gave very specific instructions, pure research (use Agent explore instead). ' +
        'In plan mode you can read files, write plans to .jdcagnet/plans/, and dispatch explore agents. ' +
        'Call exit_plan_mode when ready for user review.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    async execute(_input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      onEnter()
      return {
        content: 'Plan mode activated. You can now read files, search code, and write your plan to .jdcagnet/plans/. Call exit_plan_mode when ready for user review.',
      }
    },
  }
}
