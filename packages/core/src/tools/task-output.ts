import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { BackgroundTaskManager } from '../background-tasks.js'

export function createTaskOutputTool(mgr: BackgroundTaskManager): ToolHandler {
  return {
    definition: {
      name: 'task_output',
      description:
        'Get raw stdout/stderr output of a shell or agent background task. ' +
        'NOT for team tasks — use background_events instead for teams. ' +
        'Use tail param to avoid flooding context with large outputs.',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'The background task ID' },
          tail: { type: 'number', description: 'Only return last N lines' },
        },
        required: ['task_id'],
      },
    },
    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const taskId = input.task_id as string
      const tail = input.tail as number | undefined
      const task = mgr.getTask(taskId)
      if (!task) return { content: `Error: task ${taskId} not found`, isError: true }

      const output = mgr.getOutput(taskId, tail)
      const header = `Task ${taskId}: ${task.status} (command: ${task.command})\nExit code: ${task.exitCode ?? 'still running'}\n---\n`
      return { content: header + (output || '(no output yet)') }
    },
  }
}
