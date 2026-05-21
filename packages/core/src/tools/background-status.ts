import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { BackgroundTaskManager } from '../background-tasks.js'
import type { TeamRegistry } from '../team/team-registry.js'

export interface BackgroundStatusDeps {
  backgroundTasks: BackgroundTaskManager
  teamRegistry: TeamRegistry
}

export function createBackgroundStatusTool(deps: BackgroundStatusDeps): ToolHandler {
  return {
    definition: {
      name: 'background_status',
      description: 'Get structured status of a background task (shell/agent/team). For teams, includes manager state, member statuses, and task progress.',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Background task ID' },
        },
        required: ['task_id'],
      },
    },
    async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const taskId = input.task_id as string
      const task = deps.backgroundTasks.getTask(taskId)
      if (!task) return { content: `Error: task ${taskId} not found`, isError: true }

      if (task.type !== 'team') {
        return {
          content: JSON.stringify({
            type: task.type,
            id: task.id,
            status: task.status,
            startedAt: task.startedAt,
            completedAt: task.completedAt,
          }, null, 2),
        }
      }

      const team = deps.teamRegistry.get(taskId)
      if (!team) {
        return {
          content: JSON.stringify({
            type: 'team',
            id: task.id,
            status: task.status,
            note: 'Team has finished or is not active in registry',
          }, null, 2),
        }
      }

      const tasks = team.getTasks()
      const stats = {
        total: tasks.length,
        completed: tasks.filter(t => t.status === 'completed').length,
        running: tasks.filter(t => t.status === 'running' || t.status === 'assigned').length,
        blocked: tasks.filter(t => t.status === 'blocked').length,
        cancelled: tasks.filter(t => t.status === 'cancelled').length,
        todo: tasks.filter(t => t.status === 'todo').length,
        failed: tasks.filter(t => t.status === 'failed').length,
      }

      const status = {
        type: 'team',
        id: team.id,
        objective: team.objective,
        status: team.getStatus(),
        manager: team.getManagerState(),
        members: team.getMembers().map(m => ({
          id: m.id,
          role: m.role,
          agentType: m.agentType,
          status: m.status,
          currentTaskId: m.currentTaskId,
          toolCount: m.toolCount,
          lastActivityAt: m.lastActivityAt,
        })),
        tasks: stats,
      }

      return { content: JSON.stringify(status, null, 2) }
    },
  }
}
