import { spawn } from 'node:child_process'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import { findGitBash } from '../utils/shell-detection.js'

export const monitorTool: ToolHandler = {
  definition: {
    name: 'monitor',
    description:
      'Start a background monitor that streams events. Each stdout line is a progress event.\n\n' +
      'Choose the right tool:\n' +
      '- Need ONE notification when done → use bash with run_in_background\n' +
      '- Need ongoing events (log tail, file watch) → use this tool\n\n' +
      'Script best practices:\n' +
      '- Always use grep --line-buffered in pipes — without it, pipe buffering delays events by minutes\n' +
      '- In poll loops, handle transient failures (|| true) — one failed request should not kill the monitor\n' +
      '- Poll intervals: 30s+ for remote APIs (rate limits), 0.5-1s for local checks\n' +
      '- Only stdout is the event stream\n\n' +
      'Coverage — silence is not success: your filter must match failure states too (Traceback, Error, FAILED, Killed, OOM), not just the happy path. ' +
      'If the process crashes, would your filter emit anything? If not, widen it.',
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
      const isWindows = process.platform === 'win32'
      let shellCmd: string
      let shellArgs: string[]

      if (isWindows) {
        const gitBash = findGitBash()
        if (gitBash) {
          shellCmd = gitBash
          shellArgs = ['-c', command]
        } else {
          shellCmd = 'powershell.exe'
          shellArgs = ['-NoProfile', '-NonInteractive', '-Command', command]
        }
      } else {
        shellCmd = 'sh'
        shellArgs = ['-c', command]
      }

      const proc = spawn(shellCmd, shellArgs, { cwd: context.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      const lines: string[] = []
      let killed = false

      const killProc = () => {
        killed = true
        if (isWindows) {
          try { spawn('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { stdio: 'ignore' }) } catch {}
        } else {
          proc.kill('SIGTERM')
        }
      }

      const timer = setTimeout(killProc, timeout)

      const onAbort = killProc
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
