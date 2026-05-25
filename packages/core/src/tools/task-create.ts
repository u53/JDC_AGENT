import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { TaskStore } from '../task-store.js'

export function createTaskCreateTool(store: TaskStore): ToolHandler {
  return {
    definition: {
      name: 'task_create',
      description:
        'Create a new task to track work progress. The task appears in the user\'s task panel. ' +
        'Use for complex multi-step tasks (3+ steps), when the user provides multiple things to do, or when starting plan mode. ' +
        'Do NOT use for single trivial operations completable in 1-2 steps. ' +
        'Set subject in imperative form (e.g., "Fix auth bug", "Add pagination"). ' +
        'After creating, use task_update to set in_progress BEFORE starting work. ' +
        'Mark each task completed as soon as it\'s done — don\'t batch updates. ' +
        'Use todo_write for batch creation of multiple tasks at once.',
      inputSchema: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'Brief title for the task' },
          description: { type: 'string', description: 'What needs to be done' },
        },
        required: ['subject', 'description'],
      },
    },
    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const task = store.create(input.subject as string, input.description as string)
      return { content: `Created task #${task.id}: "${task.subject}" [${task.status}]` }
    },
  }
}
