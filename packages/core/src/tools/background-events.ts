import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { BackgroundTaskManager } from '../background-tasks.js'

export interface BackgroundEventsDeps {
  backgroundTasks: BackgroundTaskManager
}

export function createBackgroundEventsTool(deps: BackgroundEventsDeps): ToolHandler {
  return {
    definition: {
      name: 'background_events',
      description: 'Get structured events from a background task (mainly useful for teams). Returns event log with task assignments, member progress, tool usage, manager decisions, etc.',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Background task ID' },
          tail: { type: 'number', description: 'Return only the last N events' },
        },
        required: ['task_id'],
      },
    },
    async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const taskId = input.task_id as string
      const tail = input.tail as number | undefined
      const task = deps.backgroundTasks.getTask(taskId)
      if (!task) return { content: `Error: task ${taskId} not found`, isError: true }

      const events = deps.backgroundTasks.getEvents(taskId, tail)
      const isTerminal = task.status === 'completed' || task.status === 'failed'
      if (events.length === 0) {
        return {
          content: isTerminal
            ? `(no events recorded; task is ${task.status} — do not poll background_events on this id again)`
            : '(no events recorded)',
        }
      }

      const lines = events.map(e => {
        const ts = new Date(e.timestamp).toISOString().slice(11, 19)
        switch (e.type) {
          case 'team_started': return `[${ts}] team_started ${e.teamId}`
          case 'manager_decision': return `[${ts}] PM: ${e.text}`
          case 'manager_reply': return `[${ts}] PM (reply): ${e.text}`
          case 'member_created': return `[${ts}] member_created ${e.memberId} (${e.role})`
          case 'member_added': return `[${ts}] member_added ${e.memberId} (${e.role}, ${e.agentType})${e.reason ? ` — ${e.reason}` : ''}`
          case 'member_removed': return `[${ts}] member_removed ${e.memberId} (${e.role})${e.reason ? ` — ${e.reason}` : ''}`
          case 'task_created': return `[${ts}] task_created ${e.taskId} "${e.title}"`
          case 'task_assigned': return `[${ts}] task_assigned ${e.taskId} -> ${e.memberId}`
          case 'task_completed': return `[${ts}] task_completed ${e.taskId} by ${e.memberId}`
          case 'task_cancelled': return `[${ts}] task_cancelled ${e.taskId}: ${e.reason}`
          case 'member_progress': return `[${ts}] [${e.memberId}] ${e.text}`
          case 'tool_start': return `[${ts}] [${e.memberId}] tool_start: ${e.toolName}`
          case 'tool_complete': return `[${ts}] [${e.memberId}] tool_complete: ${e.toolName}`
          case 'tool_error': return `[${ts}] [${e.memberId}] tool_error: ${e.toolName}${e.reason ? ` — ${e.reason}` : ''}`
          case 'message_sent': return `[${ts}] msg: ${e.from} -> ${e.to} (${e.intent})`
          case 'intervention_received': return `[${ts}] intervention from ${e.from}: ${e.intent}`
          case 'team_synthesizing': return `[${ts}] team_synthesizing`
          case 'team_completed': return `[${ts}] team_completed`
          case 'team_failed': return `[${ts}] team_failed: ${e.error}`
          default: return `[${ts}] ${(e as any).type}`
        }
      })
      const body = lines.join('\n')
      const footer = isTerminal
        ? `\n\n[Task is ${task.status}. Do NOT call background_events on this id again — the team is done.]`
        : ''
      return { content: body + footer }
    },
  }
}
