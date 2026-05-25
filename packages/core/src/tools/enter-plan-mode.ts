import path from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export const PLAN_MODE_ALLOWED_TOOLS = [
  'file_read', 'glob', 'grep', 'ls', 'tree', 'lsp',
  'file_write', 'Agent', 'Skill',
  'exit_plan_mode',
  'task_create', 'task_get', 'task_list', 'task_update',
  'background_status', 'background_events', 'team_list',
]

export function isPlanModeToolAllowed(
  toolName: string,
  input: Record<string, unknown>,
  cwd?: string
): boolean {
  if (!PLAN_MODE_ALLOWED_TOOLS.includes(toolName)) return false

  if (toolName === 'file_write') {
    const filePath = (input.file_path || input.path || '') as string
    if (!cwd) return false
    const resolved = path.resolve(cwd, filePath)
    const planDir = path.resolve(cwd, '.jdcagnet', 'plans')
    return resolved.startsWith(planDir + path.sep) || resolved.startsWith(planDir + '/')
  }

  if (toolName === 'Agent') {
    return input.type === 'explore'
  }

  return true
}

export type PlanModeCallback = () => void

export function createEnterPlanModeTool(onEnter: PlanModeCallback): ToolHandler {
  return {
    definition: {
      name: 'enter_plan_mode',
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
