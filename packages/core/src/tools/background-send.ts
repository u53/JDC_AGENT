import { v4 as uuid } from 'uuid'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { BackgroundTaskManager } from '../background-tasks.js'
import type { TeamRegistry } from '../team/team-registry.js'
import type { TeamMessage, TeamMessageIntent, Priority } from '../team/team-types.js'

export interface BackgroundSendDeps {
  backgroundTasks: BackgroundTaskManager
  teamRegistry: TeamRegistry
}

export function createBackgroundSendTool(deps: BackgroundSendDeps): ToolHandler {
  return {
    definition: {
      name: 'background_send',
      description:
        'Send a message to a running team. Goes to the PM mailbox by default. ' +
        'Typical uses: "hurry" when deadline approaches, "narrow_scope" to reduce work, ' +
        '"request_status" for a PM-generated summary, "wrap_up" to signal time to finish. ' +
        'Do NOT use for routine monitoring — use background_status/events instead. ' +
        'Use target to direct messages: "manager" (default), "team" (broadcast), or "member:<id>".',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Team/background task ID' },
          message: { type: 'string', description: 'Message content' },
          target: { type: 'string', description: 'Target: manager (default), team, or member:<id>' },
          intent: {
            type: 'string',
            enum: ['message', 'hurry', 'wrap_up', 'request_status', 'reprioritize', 'narrow_scope', 'expand_scope', 'assign', 'schedule'],
            description: 'Message intent',
          },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        },
        required: ['task_id', 'message'],
      },
    },
    async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const taskId = input.task_id as string
      const content = input.message as string
      const target = (input.target as string | undefined) ?? 'manager'
      const intent = ((input.intent as string | undefined) ?? 'message') as TeamMessageIntent
      const priority = ((input.priority as string | undefined) ?? 'normal') as Priority

      const task = deps.backgroundTasks.getTask(taskId)
      if (!task) return { content: `Error: task ${taskId} not found`, isError: true }
      if (task.type !== 'team') return { content: `Error: task ${taskId} is not a team`, isError: true }

      const msg: TeamMessage = {
        id: `msg_${uuid().slice(0, 6)}`,
        from: 'main_session',
        to: target,
        intent,
        content,
        priority,
        createdAt: Date.now(),
      }

      deps.backgroundTasks.sendMessage(taskId, msg)
      const team = deps.teamRegistry.get(taskId)
      if (team) team.sendMessage(msg)

      return { content: `Message sent to ${target} (intent: ${intent}, priority: ${priority})` }
    },
  }
}
