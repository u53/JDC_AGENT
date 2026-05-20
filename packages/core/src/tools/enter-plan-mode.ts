import path from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export const PLAN_MODE_ALLOWED_TOOLS = [
  'file_read', 'glob', 'grep', 'ls', 'tree', 'lsp',
  'file_write', 'Agent',
  'exit_plan_mode',
  'task_create', 'task_get', 'task_list', 'task_update',
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
        'In plan mode, you can only read files, write plan files to .jdcagnet/plans/, and dispatch explore agents. ' +
        'Use this for non-trivial tasks where getting alignment first prevents wasted effort.',
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
