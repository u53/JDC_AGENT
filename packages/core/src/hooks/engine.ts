import { exec } from 'node:child_process'
import type { HookConfig, HookEvent, HookInput, HookOutput } from './types.js'
import { getMatchingHooks } from './loader.js'
import { findGitBash } from '../utils/shell-detection.js'

export class HookEngine {
  private config: HookConfig

  constructor(config: HookConfig) {
    this.config = config
  }

  updateConfig(config: HookConfig): void {
    this.config = config
  }

  async runPreToolUse(input: Omit<HookInput, 'hook_event'>): Promise<HookOutput> {
    return this.run('PreToolUse', input)
  }

  async runPostToolUse(input: Omit<HookInput, 'hook_event'>): Promise<HookOutput> {
    return this.run('PostToolUse', input)
  }

  async runSessionStart(input: Omit<HookInput, 'hook_event'>): Promise<void> {
    await this.run('SessionStart', input)
  }

  async runSessionEnd(input: Omit<HookInput, 'hook_event'>): Promise<void> {
    await this.run('SessionEnd', input)
  }

  private async run(event: HookEvent, partialInput: Omit<HookInput, 'hook_event'>): Promise<HookOutput> {
    const input: HookInput = { hook_event: event, ...partialInput }
    const rules = getMatchingHooks(this.config, event, input.tool_name)
    let combined: HookOutput = {}

    for (const rule of rules) {
      for (const hook of rule.hooks) {
        const output = await this.executeCommand(hook.command, input, hook.timeout ?? 10000)
        if (output.decision === 'block') return output
        if (output.message) combined.message = (combined.message || '') + output.message + '\n'
      }
    }
    if (combined.message) combined.message = combined.message.trimEnd()
    return combined
  }

  private executeCommand(command: string, input: HookInput, timeout: number): Promise<HookOutput> {
    return new Promise((resolve) => {
      const env = {
        ...process.env,
        TOOL_NAME: input.tool_name || '',
        SESSION_ID: input.session_id,
        CWD: input.cwd,
        HOOK_EVENT: input.hook_event,
      }

      // On Windows, exec() defaults to cmd.exe which can't run POSIX hook scripts.
      // Use Git Bash if available, otherwise PowerShell.
      let shellOpt: { shell?: string } = {}
      if (process.platform === 'win32') {
        const gitBash = findGitBash()
        if (gitBash) {
          shellOpt = { shell: gitBash }
        } else {
          shellOpt = { shell: 'powershell.exe' }
        }
      }

      const child = exec(command, { timeout, cwd: input.cwd, env, ...shellOpt }, (error, stdout) => {
        if (error) {
          resolve({ message: `Hook error: ${error.message}` })
          return
        }
        const trimmed = stdout.trim()
        if (!trimmed) { resolve({}); return }
        try {
          resolve(JSON.parse(trimmed) as HookOutput)
        } catch {
          resolve({ message: trimmed })
        }
      })

      child.stdin?.write(JSON.stringify(input))
      child.stdin?.end()
    })
  }
}
