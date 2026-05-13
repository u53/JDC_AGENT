import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { TaskStore } from '../task-store.js'

export function createTaskListTool(store: TaskStore): ToolHandler {
  return {
    definition: {
      name: 'task_list',
      description: 'List all tasks.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    async execute(_input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const tasks = store.list()
      if (tasks.length === 0) {
        return { content: 'No tasks.' }
      }
      const lines = tasks.map(t => `#${t.id} [${t.status}] ${t.subject}`)
      return { content: lines.join('\n') }
    },
  }
}
