import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { TaskStore } from '../task-store.js'

export function createTaskGetTool(store: TaskStore): ToolHandler {
  return {
    definition: {
      name: 'task_get',
      description: 'Get details of a specific task by ID.',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The ID of the task to retrieve' },
        },
        required: ['taskId'],
      },
    },
    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const task = store.get(input.taskId as string)
      if (!task) {
        return { content: `Task not found: ${input.taskId}`, isError: true }
      }
      return {
        content: `Task #${task.id}\nSubject: ${task.subject}\nDescription: ${task.description}\nStatus: ${task.status}\nCreated: ${new Date(task.createdAt).toISOString()}`,
      }
    },
  }
}
