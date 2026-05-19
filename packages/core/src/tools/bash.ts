import { spawn } from 'node:child_process'
import { readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

/**
 * Environment variables injected into every bash subprocess to ensure
 * non-interactive execution. Without these, many CLI tools (npm, apt, git,
 * pip, etc.) will hang waiting for user input or display interactive prompts.
 */
export function getNonInteractiveEnv(cwd: string): Record<string, string> {
  return {
    ...process.env as Record<string, string>,
    // Prevent terminal-based prompts and color escape sequences
    TERM: 'dumb',
    // Signal to tools that we're in a CI-like non-interactive environment
    CI: 'true',
    // Prevent git from opening /dev/tty for credential/editor prompts
    GIT_TERMINAL_PROMPT: '0',
    // Prevent apt/dpkg from opening interactive config dialogs
    DEBIAN_FRONTEND: 'noninteractive',
    // Prevent npm from prompting for input
    npm_config_yes: 'true',
    // Prevent yarn from prompting
    YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
    // Prevent pip from prompting
    PIP_NO_INPUT: '1',
    // Prevent pnpm from prompting
    npm_config_reporter: 'silent',
    // Disable color output that clutters tool results
    NO_COLOR: '1',
    // Prevent Python from buffering output (ensures we see output in real-time)
    PYTHONUNBUFFERED: '1',
    // Prevent .NET interactive prompts
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    DOTNET_NOLOGO: '1',
    // Prevent Homebrew from prompting or auto-updating
    HOMEBREW_NO_AUTO_UPDATE: '1',
    HOMEBREW_NO_INSTALL_CLEANUP: '1',
    // Set a sensible editor fallback that won't block
    GIT_EDITOR: 'true',
    EDITOR: 'true',
    VISUAL: 'true',
    // Preserve CWD for reference
    JDCAGNET_CWD: cwd,
  }
}

export const bashTool: ToolHandler = {
  definition: {
    name: 'bash',
    description: `Execute a bash command and return its output (stdout + stderr).

The shell runs in a non-interactive environment (CI=true, GIT_TERMINAL_PROMPT=0, DEBIAN_FRONTEND=noninteractive). Commands that require interactive input will fail — use appropriate flags to bypass prompts (e.g., --yes, -y, --non-interactive, --batch).

# Tool Preference
- Do NOT use bash for operations that have dedicated tools: use file_read instead of cat/head/tail, file_edit instead of sed/awk, file_write instead of echo redirection, glob instead of find, grep instead of shell grep.
- Reserve bash for: running builds, tests, git commands, package managers, and system operations.

# Execution
- Commands timeout after 120 seconds by default. Use the timeout parameter for longer operations (max 600000ms / 10 minutes).
- Use run_in_background: true for long-running processes (servers, builds >2min). Returns a task_id — use task_output to check results later.
- stdin is redirected from /dev/null — commands cannot read interactive input.
- The working directory is tracked across calls. If your command changes directory (cd), the next command will start from the new directory.

# Command Patterns
- Use absolute paths. Avoid relying on relative paths.
- Quote file paths containing spaces with double quotes.
- For multiple independent commands, make separate parallel tool calls.
- For dependent commands, chain with && (stops on first failure).
- Use ; only when you need sequential execution regardless of failure.
- Do NOT use newlines to separate commands (newlines are OK inside quoted strings).
- Never use interactive flags (-i) as they require unsupported input.

# Search & Filesystem
- When running find, search from . or a specific path, NOT /. Scanning the full filesystem exhausts resources on large trees.
- When using find -regex with alternation, put the longest alternative first: use '.*\\.(tsx|ts)' not '.*\\.(ts|tsx)' — the second form may silently skip .tsx files.
- Prefer ls over find for simple directory listing.

# Package Managers & Installers
- npm: use --yes or set scripts to non-interactive mode
- apt-get: use -y flag (DEBIAN_FRONTEND=noninteractive is already set)
- pip: use --no-input (PIP_NO_INPUT=1 is already set)
- brew: HOMEBREW_NO_AUTO_UPDATE=1 is set, but still use --quiet for less noise
- cargo: use --quiet for less noise
- go: most commands are non-interactive by default

# Avoiding Hangs
- Do not use sleep loops to poll — diagnose the root cause instead.
- If a command might prompt for input, add the appropriate --yes/-y/--batch flag.
- If a command opens an editor (git commit without -m, git rebase -i), it will fail. Always provide messages inline.
- If waiting for a background task, use task_output to check — do not poll with sleep.

# Git Safety Protocol
- NEVER commit changes unless the user explicitly asks you to
- NEVER update the git config
- NEVER run destructive git commands (push --force, reset --hard, checkout ., clean -f, branch -D) unless the user explicitly requests
- NEVER skip hooks (--no-verify) unless the user explicitly asks
- CRITICAL: Always create NEW commits rather than amending. When a pre-commit hook fails, the commit did NOT happen — --amend would modify the PREVIOUS commit. Fix the issue, re-stage, create a NEW commit.
- When staging files, prefer adding specific files by name rather than "git add -A" or "git add ."
- Never use git commands with -i flag (git rebase -i, git add -i) — they require interactive input.

# Commit Workflow (when user asks):
1. Run in parallel: git status, git diff, git log --oneline -5
2. Analyze changes, draft commit message (focus on "why" not "what")
3. Stage specific files, create commit with HEREDOC format:
   git commit -m "$(cat <<'EOF'
   commit message here
   EOF
   )"
4. If hook fails: fix, re-stage, NEW commit (never --amend)

# PR Workflow (when user asks):
1. Run: git status, git log main..HEAD, git diff main...HEAD
2. Draft title (<70 chars) and description
3. Push with -u, create PR with gh pr create`,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to execute' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default 120000, max 600000)' },
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

    const env = getNonInteractiveEnv(context.cwd)

    if (input.run_in_background && context.backgroundTasks) {
      const task = context.backgroundTasks.spawn(command, context.cwd, env)
      return { content: `Background task started: ${task.id}\nCommand: ${command}\nUse task_output tool to check results.` }
    }

    const rawTimeout = (input.timeout as number) || 120000
    const timeout = Math.min(rawTimeout, 600000)

    // CWD tracking: append pwd -P to capture the final working directory
    const cwdFile = join(tmpdir(), `jdcagnet-cwd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    const wrappedCommand = `${command}; __jdcagnet_exit=$?; pwd -P > ${cwdFile} 2>/dev/null; exit $__jdcagnet_exit`

    return new Promise((resolve) => {
      const proc = spawn('bash', ['-c', wrappedCommand], {
        cwd: context.cwd,
        timeout,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
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
        // Read the CWD after command execution for tracking
        try {
          const newCwd = readFileSync(cwdFile, 'utf-8').trim()
          if (newCwd && newCwd !== context.cwd) {
            // Store the new CWD so the session can update
            ;(context as unknown as Record<string, unknown>).__newCwd = newCwd
          }
        } catch {
          // CWD file may not exist if command was killed
        }
        try { unlinkSync(cwdFile) } catch {}

        const output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '')
        resolve({ content: output || '(no output)', isError: code !== 0 })
      })

      proc.on('error', (err) => {
        try { unlinkSync(cwdFile) } catch {}
        resolve({ content: `Failed to execute: ${err.message}`, isError: true })
      })

      if (context.signal?.aborted) {
        try { process.kill(-proc.pid!, 'SIGKILL') } catch {}
      } else {
        context.signal?.addEventListener('abort', () => {
          try { process.kill(-proc.pid!, 'SIGTERM') } catch {}
          setTimeout(() => { try { process.kill(-proc.pid!, 'SIGKILL') } catch {} }, 500)
        })
      }
    })
  },
}
