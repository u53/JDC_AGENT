import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { TaskStore } from '../task-store.js'

export function createTaskCreateTool(store: TaskStore): ToolHandler {
  return {
    definition: {
      name: 'task_create',
      description: 'Create a new task to track work.',
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
