import { spawn } from 'node:child_process'
import { readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import { getNonInteractiveEnv } from './bash.js'

export type PowerShellEdition = 'core' | 'desktop'

function detectEdition(shellPath: string): PowerShellEdition {
  const base = shellPath.split(/[/\\]/).pop()?.toLowerCase().replace(/\.exe$/, '') || ''
  return base === 'pwsh' ? 'core' : 'desktop'
}

function getEditionPrompt(edition: PowerShellEdition): string {
  if (edition === 'core') {
    return `PowerShell edition: PowerShell 7+ (pwsh)
- Pipeline chain operators \`&&\` and \`||\` ARE available. Prefer \`cmd1 && cmd2\` when cmd2 should only run if cmd1 succeeds.
- Ternary (\`$cond ? $a : $b\`), null-coalescing (\`??\`), and null-conditional (\`?.\`) operators are available.
- Default file encoding is UTF-8 without BOM.`
  }
  return `PowerShell edition: Windows PowerShell 5.1 (powershell.exe)
- Pipeline chain operators \`&&\` and \`||\` are NOT available — they cause a parser error. To run B only if A succeeds: \`A; if ($?) { B }\`. Unconditionally: \`A; B\`.
- Ternary, null-coalescing, and null-conditional operators are NOT available. Use if/else instead.
- Avoid \`2>&1\` on native executables — it wraps stderr in ErrorRecord and sets $? to $false even on exit 0.
- Default file encoding is UTF-16 LE. Use \`-Encoding utf8\` with Out-File/Set-Content.`
}

export function createPowerShellTool(shellPath: string): ToolHandler {
  const edition = detectEdition(shellPath)

  return {
    definition: {
      name: 'Powershell',
      description: `Execute a PowerShell command. Working directory persists between calls; shell state (variables, functions) does not.

${getEditionPrompt(edition)}

# When to use
- Use this tool for terminal operations on Windows: git, npm, docker, dotnet, and PowerShell cmdlets.
- Do NOT use for file operations (reading, writing, editing, searching) — use dedicated tools instead.

# Execution
- Commands timeout after 120 seconds by default. Use the timeout parameter for longer operations (max 600000ms / 10 minutes).
- Use run_in_background: true for long-running processes (servers, builds >2min). Returns a task_id — use task_output to check results later.
- The working directory is tracked across calls. If your command changes directory (Set-Location/cd), the next command will start from the new directory.
- Output exceeding 100000 characters will be truncated (first 50000 + last 50000).
- Do NOT prefix commands with \`cd\` or \`Set-Location\` — the working directory is already set to the correct project directory automatically.
- It is very helpful if you write a clear, concise description of what this command does.

# Syntax Notes
- Variables: $myVar = "value"
- Escape character: backtick (\`), not backslash
- Cmdlet naming: Get-ChildItem, Set-Location, New-Item, Remove-Item
- Common aliases: ls (Get-ChildItem), cd (Set-Location), cat (Get-Content), rm (Remove-Item)
- Pipe | passes objects, not text. Use Select-Object, Where-Object, ForEach-Object.
- String interpolation: "Hello $name" or "Hello $($obj.Property)"
- Environment variables: $env:NAME (read), $env:NAME = "value" (set)
- Call exe with spaces: & "C:\\Program Files\\App\\app.exe" arg1 arg2
- Registry: HKLM:\\SOFTWARE\\..., HKCU:\\...
- For arguments with special chars, use stop-parsing token: git log --% --format=%H

# Interactive commands (will hang — runs with -NonInteractive)
- NEVER use Read-Host, Get-Credential, Out-GridView, $Host.UI.PromptForChoice, or pause
- Add -Confirm:$false to destructive cmdlets (Remove-Item, Stop-Process, Clear-Content, etc.)
- Use -Force for read-only/hidden items
- Never use git rebase -i or git add -i

# Multiline strings (commit messages, file content)
- Use single-quoted here-string. The closing '@ MUST be at column 0 (no leading whitespace):
  git commit -m @'
  Commit message here.
  Second line with $literal dollar signs.
  '@
- Use @'...'@ (literal) not @"..."@ (interpolated) unless you need variable expansion

# Command chaining
${edition === 'core' ? '- Use && for conditional chaining, ; for unconditional' : '- Use A; if ($?) { B } for conditional chaining, ; for unconditional'}
- For independent commands, make separate parallel tool calls
- Do NOT use newlines to separate commands (newlines are OK in here-strings)

# Avoiding Hangs
- Do not use Start-Sleep loops to poll — diagnose the root cause instead.
- If a command might prompt for input, add -Confirm:$false or appropriate flags.
- If a command opens an editor (git commit without -m), it will fail. Always provide messages inline.
- If waiting for a background task, use task_output to check — do not poll with Start-Sleep.

# Tool preference
- File search: Use glob (NOT Get-ChildItem -Recurse)
- Content search: Use grep (NOT Select-String)
- Read files: Use file_read (NOT Get-Content)
- Edit files: Use file_edit
- Write files: Use file_write (NOT Set-Content/Out-File)
- Communication: Output text directly (NOT Write-Output/Write-Host)

# Git Safety Protocol
- NEVER commit changes unless the user explicitly asks you to
- NEVER update the git config
- NEVER run destructive git commands (push --force, reset --hard, checkout ., clean -f, branch -D) unless the user explicitly requests
- NEVER skip hooks (--no-verify) unless the user explicitly asks
- CRITICAL: Always create NEW commits rather than amending. When a pre-commit hook fails, the commit did NOT happen — --amend would modify the PREVIOUS commit.
- When staging files, prefer adding specific files by name rather than "git add -A" or "git add ."
- Never use git commands with -i flag (git rebase -i, git add -i) — they require interactive input.`,
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The PowerShell command to execute' },
          timeout: { type: 'number', description: 'Timeout in milliseconds (default 120000, max 600000)' },
          run_in_background: { type: 'boolean', description: 'Run in background and return task_id immediately' },
        },
        required: ['command'],
      },
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const command = input.command as string | undefined
      if (!command) {
        return { content: 'Error: command is required', isError: true }
      }

      const env = getNonInteractiveEnv(context.cwd)

      if (input.run_in_background && context.backgroundTasks) {
        const task = context.backgroundTasks.spawn(command, context.cwd, env)
        return { content: `Background task started: ${task.id}\nCommand: ${command}\nUse task_output tool to check results.` }
      }

      const rawTimeout = (input.timeout as number) || 120000
      const timeout = Math.min(rawTimeout, 600000)

      const cwdFile = join(tmpdir(), `jdcagnet-ps-cwd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
      const escapedCwdFile = cwdFile.replace(/'/g, "''")

      // Append CWD tracking and exit code capture
      const cwdTracking = `\n; $_ec = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }\n; (Get-Location).Path | Out-File -FilePath '${escapedCwdFile}' -Encoding utf8 -NoNewline\n; exit $_ec`
      const fullCommand = command + cwdTracking

      const shellArgs = ['-NoProfile', '-NonInteractive', '-Command', fullCommand]

      return new Promise((resolve) => {
        const proc = spawn(shellPath, shellArgs, {
          cwd: context.cwd,
          timeout,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
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
          // Read CWD
          try {
            const newCwd = readFileSync(cwdFile, 'utf-8').trim().replace(/^﻿/, '')
            if (newCwd && newCwd !== context.cwd) {
              ;(context as unknown as Record<string, unknown>).__newCwd = newCwd
            }
          } catch {}
          try { unlinkSync(cwdFile) } catch {}

          const output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '')
          const MAX_OUTPUT = 100000
          const truncated = output.length > MAX_OUTPUT
            ? output.slice(0, 50000) + `\n\n... [${output.length - 100000} bytes truncated] ...\n\n` + output.slice(-50000)
            : output

          resolve({ content: truncated || '(no output)', isError: code !== 0 })
        })

        proc.on('error', (err) => {
          try { unlinkSync(cwdFile) } catch {}
          resolve({ content: `Failed to execute: ${err.message}`, isError: true })
        })

        const killProc = () => {
          try { spawn('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { stdio: 'ignore' }) } catch {}
        }

        if (context.signal?.aborted) {
          killProc()
        } else {
          context.signal?.addEventListener('abort', killProc)
        }
      })
    },
  }
}
