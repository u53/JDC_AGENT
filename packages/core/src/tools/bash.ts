import { spawn } from 'node:child_process'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export const bashTool: ToolHandler = {
  definition: {
    name: 'bash',
    description: `Execute a bash command and return its output (stdout + stderr).

Usage notes:
- Do NOT use bash for operations that have dedicated tools: use file_read instead of cat/head/tail, file_edit instead of sed/awk, file_write instead of echo redirection, glob instead of find, grep instead of shell grep.
- Reserve bash for: running builds, tests, git commands, package managers, and system operations.
- Commands timeout after 120 seconds by default. Use the timeout parameter for longer operations.
- Use run_in_background: true for long-running processes (servers, builds >2min). Returns a task_id — use task_output to check results later.
- Use absolute paths. Do not rely on working directory state between calls.
- Quote file paths containing spaces with double quotes.
- For multiple independent commands, make separate parallel tool calls. For dependent commands, chain with &&.
- Never use interactive flags (-i) as they require unsupported input.
- When running find, search from the project root, not /. Scanning the full filesystem exhausts resources.

Git Safety Protocol:
- NEVER commit changes unless the user explicitly asks you to
- NEVER update the git config
- NEVER run destructive git commands (push --force, reset --hard, checkout ., clean -f, branch -D) unless the user explicitly requests
- NEVER skip hooks (--no-verify) unless the user explicitly asks
- CRITICAL: Always create NEW commits rather than amending. When a pre-commit hook fails, the commit did NOT happen — --amend would modify the PREVIOUS commit. Fix the issue, re-stage, create a NEW commit.
- When staging files, prefer adding specific files by name rather than "git add -A" or "git add ."

Committing changes (when user asks):
1. Run in parallel: git status, git diff, git log --oneline -5
2. Analyze changes, draft commit message (focus on "why" not "what")
3. Stage specific files, create commit with HEREDOC format
4. If hook fails: fix, re-stage, NEW commit

Creating PRs (when user asks):
1. Run: git status, git log main..HEAD, git diff main...HEAD
2. Draft title (<70 chars) and description
3. Push with -u, create PR with gh pr create`,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to execute' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default 120000)' },
        run_in_background: { type: 'boolean', description: 'Run in background and return task_id immediately (default: false)' },
      },
      required: ['command'],
    },
  },
  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const command = input.command as string | undefined
    if (!command) {
      return { content: 'Error: command is required', isError: true }
    }

    if (input.run_in_background && context.backgroundTasks) {
      const task = context.backgroundTasks.spawn(command, context.cwd)
      return { content: `Background task started: ${task.id}\nCommand: ${command}\nUse task_output tool to check results.` }
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
