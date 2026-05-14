import { spawn } from 'node:child_process'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export const monitorTool: ToolHandler = {
  definition: {
    name: 'monitor',
    description: 'Run a command and stream each stdout line as a progress event. Use for watching logs, waiting for conditions, or monitoring long processes.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command. Each stdout line becomes a progress event.' },
        description: { type: 'string', description: 'What you are monitoring (shown in UI)' },
        timeout_ms: { type: 'number', description: 'Kill after this time in ms (default: 300000)' },
      },
      required: ['command', 'description'],
    },
  },
  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const command = input.command as string
    const description = input.description as string
    const timeout = (input.timeout_ms as number) || 300000

    return new Promise<ToolResult>((resolve) => {
      const proc = spawn('sh', ['-c', command], { cwd: context.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      const lines: string[] = []
      let killed = false

      const timer = setTimeout(() => { killed = true; proc.kill('SIGTERM') }, timeout)

      const onAbort = () => { proc.kill('SIGTERM'); killed = true }
      context.signal?.addEventListener('abort', onAbort, { once: true })

      proc.stdout?.on('data', (data) => {
        const newLines = data.toString().split('\n').filter((l: string) => l.trim())
        for (const line of newLines) {
          lines.push(line)
          context.onProgress?.(`[${description}] ${line}`)
        }
      })

      proc.stderr?.on('data', (data) => {
        lines.push(`[stderr] ${data.toString().trim()}`)
      })

      proc.on('close', (code) => {
        clearTimeout(timer)
        context.signal?.removeEventListener('abort', onAbort)
        const status = killed ? 'timed out' : code === 0 ? 'completed' : `failed (exit ${code})`
        resolve({
          content: `Monitor "${description}" ${status}.\nEvents captured: ${lines.length}\n---\n${lines.slice(-50).join('\n')}`,
        })
      })
    })
  },
}
