import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { TaskStore } from '../task-store.js'

export function createTaskUpdateTool(store: TaskStore): ToolHandler {
  return {
    definition: {
      name: 'task_update',
      description:
        'Update a task status or content. Set in_progress BEFORE starting work, completed ONLY when FULLY accomplished. ' +
        'If errors or blockers occur, keep as in_progress. Never mark completed if: tests failing, implementation partial, or unresolved errors. ' +
        'After marking completed, call task_list to find the next pending task. ' +
        'Use status "deleted" to remove tasks that are no longer relevant or were created in error.',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The ID of the task to update' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'deleted'], description: 'New status' },
          subject: { type: 'string', description: 'New subject' },
          description: { type: 'string', description: 'New description' },
        },
        required: ['taskId'],
      },
    },
    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      if (input.status === 'deleted') {
        const deleted = store.delete(input.taskId as string)
        if (!deleted) return { content: `Task not found: ${input.taskId}`, isError: true }
        return { content: `Deleted task #${input.taskId}` }
      }

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
