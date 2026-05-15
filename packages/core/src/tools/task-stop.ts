import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { TaskStore } from '../task-store.js'

export function createTaskStopTool(store: TaskStore): ToolHandler {
  return {
    definition: {
      name: 'task_stop',
      description: 'Remove a task that is no longer needed. Do NOT use this on completed tasks — only on tasks that have become irrelevant.',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The ID of the task to stop' },
        },
        required: ['taskId'],
      },
    },
    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const deleted = store.delete(input.taskId as string)
      if (!deleted) {
        return { content: `Task not found: ${input.taskId}`, isError: true }
      }
      return { content: `Task #${input.taskId} stopped and removed.` }
    },
  }
}
