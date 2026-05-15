import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { TaskStore } from '../task-store.js'

export function createTodoWriteTool(store: TaskStore): ToolHandler {
  return {
    definition: {
      name: 'todo_write',
      description: 'Create multiple tasks at once. Preferred over calling task_create repeatedly. Use at the start of multi-step work to plan visible progress.',
      inputSchema: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                subject: { type: 'string', description: 'Task subject' },
                description: { type: 'string', description: 'Task description' },
              },
              required: ['subject'],
            },
            description: 'Array of tasks to create',
          },
        },
        required: ['todos'],
      },
    },
    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const todos = input.todos as Array<{ subject: string; description?: string }>
      for (const todo of todos) {
        store.create(todo.subject, todo.description || '')
      }
      return { content: `Created ${todos.length} tasks.` }
    },
  }
}
