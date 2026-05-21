import { v4 as uuid } from 'uuid'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { BackgroundTaskManager } from '../background-tasks.js'
import type { TeamRegistry } from '../team/team-registry.js'
import type { Priority, RiskLevel } from '../team/team-types.js'

export interface TeamAddTaskDeps {
  backgroundTasks: BackgroundTaskManager
  teamRegistry: TeamRegistry
}

export function createTeamAddTaskTool(deps: TeamAddTaskDeps): ToolHandler {
  return {
    definition: {
      name: 'team_add_task',
      description:
        'Add a new task to a running team. The PM will assign it to an available worker on the next scheduling tick. ' +
        'Use this to dynamically expand the team\'s workload after creation.',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Team ID' },
          title: { type: 'string', description: 'Task title' },
          description: { type: 'string', description: 'Task description' },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
          depends_on: {
            type: 'array',
            items: { type: 'string' },
            description: 'Task titles or IDs this task depends on',
          },
        },
        required: ['task_id', 'title', 'description'],
      },
    },
    async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const teamId = input.task_id as string
      const title = input.title as string
      const description = input.description as string
      const priority = ((input.priority as string) ?? 'normal') as Priority
      const dependsOn = input.depends_on as string[] | undefined

      const task = deps.backgroundTasks.getTask(teamId)
      if (!task) return { content: `Error: team ${teamId} not found`, isError: true }
      if (task.type !== 'team') return { content: `Error: ${teamId} is not a team`, isError: true }
      if (task.status !== 'running') return { content: `Error: team ${teamId} is not running (status: ${task.status})`, isError: true }

      const team = deps.teamRegistry.get(teamId)
      if (!team) return { content: `Error: team ${teamId} not active in registry`, isError: true }

      team.addTask({ title, description, priority, dependsOn })
      return { content: `Task "${title}" added to team ${teamId} (priority: ${priority}). It will be assigned on the next scheduling tick.` }
    },
  }
}
