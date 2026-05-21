import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { BackgroundTaskManager } from '../background-tasks.js'
import type { TeamRegistry } from '../team/team-registry.js'

export interface TeamListDeps {
  backgroundTasks: BackgroundTaskManager
  teamRegistry: TeamRegistry
}

export function createTeamListTool(deps: TeamListDeps): ToolHandler {
  return {
    definition: {
      name: 'team_list',
      description:
        'List all teams (active and completed). Returns team IDs, objectives, status, and member counts. ' +
        'Use this to find team IDs when you have lost track of them (e.g., after context compression).',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['running', 'completed', 'all'], description: 'Filter by status (default: all)' },
        },
        required: [],
      },
    },
    async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const filter = (input.status as string | undefined) ?? 'all'
      const allTasks = deps.backgroundTasks.listAll().filter(t => t.type === 'team')

      const filtered = filter === 'all'
        ? allTasks
        : allTasks.filter(t => t.status === filter)

      if (filtered.length === 0) {
        return { content: filter === 'all' ? 'No teams found.' : `No teams with status "${filter}".` }
      }

      const lines: string[] = [`Teams (${filtered.length}):\n`]
      for (const task of filtered) {
        const team = deps.teamRegistry.get(task.id)
        const memberCount = team ? team.getMembers().length : '?'
        const taskStats = team ? team.getTasks() : []
        const completed = taskStats.filter(t => t.status === 'completed').length
        const total = taskStats.length

        lines.push(`- ID: ${task.id}`)
        lines.push(`  Objective: ${task.prompt || '(unknown)'}`)
        lines.push(`  Status: ${task.status}`)
        lines.push(`  Members: ${memberCount}`)
        if (total > 0) lines.push(`  Tasks: ${completed}/${total} completed`)
        lines.push(`  Started: ${new Date(task.startedAt).toISOString().slice(0, 19)}`)
        if (task.completedAt) lines.push(`  Completed: ${new Date(task.completedAt).toISOString().slice(0, 19)}`)
        lines.push('')
      }
      return { content: lines.join('\n') }
    },
  }
}
