import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { TaskStore } from '../task-store.js'

export function createTaskUpdateTool(store: TaskStore): ToolHandler {
  return {
    definition: {
      name: 'task_update',
      description: 'Update a task\'s status, subject, or description. Set status to in_progress before starting work, completed when done.',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The ID of the task to update' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'New status' },
          subject: { type: 'string', description: 'New subject' },
          description: { type: 'string', description: 'New description' },
        },
        required: ['taskId'],
      },
    },
    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const updates: Record<string, unknown> = {}
      if (input.status !== undefined) updates.status = input.status
      if (input.subject !== undefined) updates.subject = input.subject
      if (input.description !== undefined) updates.description = input.description

      const task = store.update(input.taskId as string, updates as any)
      if (!task) {
        return { content: `Task not found: ${input.taskId}`, isError: true }
      }
      return { content: `Updated task #${task.id}: "${task.subject}" [${task.status}]` }
    },
  }
}
