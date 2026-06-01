import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { BackgroundTaskManager } from '../background-tasks.js'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function createTaskOutputTool(mgr: BackgroundTaskManager): ToolHandler {
  return {
    definition: {
      name: 'TaskOutput',
      description:
        'Get output from a background task (shell or agent). ' +
        'Use block=true (default) to wait for task completion — avoids polling. ' +
        'Use block=false for a non-blocking snapshot of current output. ' +
        'NOT for team tasks — use background_events instead.',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'The background task ID' },
          block: { type: 'boolean', description: 'Wait for task completion (default: true)', default: true },
          timeout: { type: 'number', description: 'Max wait time in ms (default: 30000, max: 600000)', default: 30000 },
          tail: { type: 'number', description: 'Only return last N lines of output' },
        },
        required: ['task_id'],
      },
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const taskId = input.task_id as string
      const block = input.block !== false
      const timeout = Math.min((input.timeout as number) || 30000, 600000)
      const tail = input.tail as number | undefined

      const task = mgr.getTask(taskId)
      if (!task) return { content: `Error: task ${taskId} not found`, isError: true }

      // Non-blocking: return current state immediately
      if (!block) {
        const output = mgr.getOutput(taskId, tail)
        return { content: formatOutput(taskId, task.status, task.command, task.exitCode, output) }
      }

      // Blocking: wait for task to finish
      if (task.status === 'running') {
        const deadline = Date.now() + timeout
        while (Date.now() < deadline) {
          if (context.signal?.aborted) {
            return { content: `Aborted while waiting for task ${taskId}`, isError: true }
          }
          const current = mgr.getTask(taskId)
          if (!current || current.status !== 'running') break
          await sleep(200)
        }
      }

      const final = mgr.getTask(taskId)
      if (!final) return { content: `Error: task ${taskId} disappeared`, isError: true }

      const status = final.status === 'running' ? 'timeout (still running)' : final.status
      const output = mgr.getOutput(taskId, tail)
      return { content: formatOutput(taskId, status, final.command, final.exitCode, output) }
    },
  }
}

function formatOutput(
  taskId: string,
  status: string,
  command: string | undefined,
  exitCode: number | undefined,
  output: string,
): string {
  const header = `Task ${taskId}: ${status}${command ? ` (command: ${command})` : ''}\nExit code: ${exitCode ?? 'N/A'}\n---\n`
  return header + (output || '(no output)')
}
