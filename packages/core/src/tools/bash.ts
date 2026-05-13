import { spawn } from 'node:child_process'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export const bashTool: ToolHandler = {
  definition: {
    name: 'bash',
    description: 'Execute a bash command and return its output.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to execute' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default 120000)' },
      },
      required: ['command'],
    },
  },
  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const command = input.command as string | undefined
    if (!command) {
      return { content: 'Error: command is required', isError: true }
    }
    const timeout = (input.timeout as number) || 120000

    return new Promise((resolve) => {
      const proc = spawn('bash', ['-c', command], {
        cwd: context.cwd,
        timeout,
        env: { ...process.env, TERM: 'dumb' },
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
        context.onProgress?.(data.toString())
      })
      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        const output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '')
        resolve({ content: output || '(no output)', isError: code !== 0 })
      })

      proc.on('error', (err) => {
        resolve({ content: `Failed to execute: ${err.message}`, isError: true })
      })

      context.signal?.addEventListener('abort', () => proc.kill())
    })
  },
}
