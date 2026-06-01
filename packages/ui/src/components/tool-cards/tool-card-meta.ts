export type ToolStatus = 'running' | 'done' | 'error'

interface ToolEventLike {
  type: 'start' | 'progress' | 'complete' | 'error'
  result?: { isError?: boolean }
}

export type ToolFamily =
  | 'agent'
  | 'command'
  | 'external'
  | 'jdc'
  | 'mcp'
  | 'mutation'
  | 'read'
  | 'search'
  | 'skill'
  | 'task'
  | 'generic'

export type ToolCardKind =
  | 'agent'
  | 'bash'
  | 'edit'
  | 'external'
  | 'generic'
  | 'jdc'
  | 'mcp'
  | 'multi-edit'
  | 'notebook-edit'
  | 'read'
  | 'search'
  | 'skill'
  | 'task'
  | 'write'

const JDC_TOOLS = new Set([
  'JdcContext',
  'JdcSearch',
  'JdcNode',
  'JdcCallers',
  'JdcCallees',
  'JdcImpact',
  'JdcTrace',
  'JdcExplore',
  'JdcFiles',
])

const COMMAND_TOOLS = new Set(['Bash', 'Powershell', 'Monitor'])
const MUTATION_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const SEARCH_TOOLS = new Set(['Glob', 'Grep', 'LS', 'Tree', 'LSP'])
const EXTERNAL_TOOLS = new Set(['WebSearch', 'WebFetch', 'ListMcpResources', 'ReadMcpResource'])
const TASK_TOOLS = new Set([
  'AskUser',
  'BackgroundEvents',
  'BackgroundSend',
  'BackgroundStatus',
  'EnterPlanMode',
  'ExitPlanMode',
  'Notify',
  'SaveMemory',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'TaskUpdate',
  'Team',
  'TodoWrite',
  'team_add_task',
  'team_artifact',
  'team_list',
  'team_report',
])

export function deriveToolStatus(
  event?: ToolEventLike,
  result?: { is_error?: boolean },
): ToolStatus {
  if (event?.result?.isError || result?.is_error) return 'error'
  if (!event) return 'done'
  if (event.type === 'complete') return 'done'
  if (event.type === 'error') return 'error'
  return 'running'
}

export function getToolFamily(toolName: string): ToolFamily {
  if (JDC_TOOLS.has(toolName) || toolName.startsWith('Jdc')) return 'jdc'
  if (/^mcp__[^_]+__.+$/.test(toolName)) return 'mcp'
  if (toolName === 'Agent') return 'agent'
  if (toolName === 'Skill') return 'skill'
  if (toolName === 'Read') return 'read'
  if (MUTATION_TOOLS.has(toolName)) return 'mutation'
  if (COMMAND_TOOLS.has(toolName)) return 'command'
  if (SEARCH_TOOLS.has(toolName)) return 'search'
  if (EXTERNAL_TOOLS.has(toolName)) return 'external'
  if (TASK_TOOLS.has(toolName)) return 'task'
  return 'generic'
}

export function getToolCardKind(toolName: string): ToolCardKind {
  if (JDC_TOOLS.has(toolName) || toolName.startsWith('Jdc')) return 'jdc'
  if (/^mcp__[^_]+__.+$/.test(toolName)) return 'mcp'

  switch (toolName) {
    case 'Agent':
      return 'agent'
    case 'Bash':
    case 'Powershell':
    case 'Monitor':
      return 'bash'
    case 'Edit':
      return 'edit'
    case 'Write':
      return 'write'
    case 'MultiEdit':
      return 'multi-edit'
    case 'NotebookEdit':
      return 'notebook-edit'
    case 'Read':
      return 'read'
    case 'Skill':
      return 'skill'
    default:
      break
  }

  const family = getToolFamily(toolName)
  if (family === 'search') return 'search'
  if (family === 'external') return 'external'
  if (family === 'task') return 'task'
  return 'generic'
}

export function shouldShowToolRail(toolName: string, status: ToolStatus): boolean {
  if (status === 'running' || status === 'error') return true
  const family = getToolFamily(toolName)
  return family === 'jdc' || family === 'mutation'
}

export function getToolVariant(toolName: string): string {
  const family = getToolFamily(toolName)
  if (family === 'mutation') return 'mutation'
  return family
}

export function formatToolLabel(toolName: string): string {
  if (!toolName) return 'TOOL'
  if (toolName === 'Powershell') return 'POWERSHELL'
  if (toolName.startsWith('team_')) return toolName.replace(/^team_/, 'TEAM ').replace(/_/g, ' ').toUpperCase()
  return toolName.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toUpperCase()
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}
