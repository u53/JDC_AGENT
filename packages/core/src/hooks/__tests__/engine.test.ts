import { describe, it, expect } from 'vitest'
import { HookEngine } from '../engine.js'
import type { HookConfig } from '../types.js'

describe('HookEngine', () => {
  it('runs command and returns allow by default', async () => {
    const config: HookConfig = {
      hooks: {
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo \'{"decision":"allow"}\'', timeout: 5000 }] }],
      },
    }
    const engine = new HookEngine(config)
    const result = await engine.runPreToolUse({ session_id: 'test', cwd: '/tmp', tool_name: 'Bash', tool_input: {} })
    expect(result.decision).not.toBe('block')
  })

  it('blocks when hook returns block decision', async () => {
    const config: HookConfig = {
      hooks: {
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo \'{"decision":"block","reason":"not allowed"}\'', timeout: 5000 }] }],
      },
    }
    const engine = new HookEngine(config)
    const result = await engine.runPreToolUse({ session_id: 'test', cwd: '/tmp', tool_name: 'Bash', tool_input: {} })
    expect(result.decision).toBe('block')
    expect(result.reason).toBe('not allowed')
  })

  it('handles empty stdout as allow', async () => {
    const config: HookConfig = {
      hooks: {
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'true', timeout: 5000 }] }],
      },
    }
    const engine = new HookEngine(config)
    const result = await engine.runPreToolUse({ session_id: 'test', cwd: '/tmp', tool_name: 'Bash', tool_input: {} })
    expect(result.decision).toBeUndefined()
  })

  it('handles timeout gracefully', async () => {
    const config: HookConfig = {
      hooks: {
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'sleep 10', timeout: 200 }] }],
      },
    }
    const engine = new HookEngine(config)
    const result = await engine.runPreToolUse({ session_id: 'test', cwd: '/tmp', tool_name: 'Bash', tool_input: {} })
    expect(result.message).toContain('Hook error')
  }, 10000)

  it('handles non-JSON stdout as message', async () => {
    const config: HookConfig = {
      hooks: {
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo "hello world"', timeout: 5000 }] }],
      },
    }
    const engine = new HookEngine(config)
    const result = await engine.runPreToolUse({ session_id: 'test', cwd: '/tmp', tool_name: 'Bash', tool_input: {} })
    expect(result.message).toBe('hello world')
  })

  it('passes input via stdin', async () => {
    const config: HookConfig = {
      hooks: {
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node -e "let d=\'\';process.stdin.on(\'data\',c=>d+=c);process.stdin.on(\'end\',()=>{const j=JSON.parse(d);process.stdout.write(JSON.stringify({message:j.tool_name}))})"', timeout: 5000 }] }],
      },
    }
    const engine = new HookEngine(config)
    const result = await engine.runPreToolUse({ session_id: 'test', cwd: '/tmp', tool_name: 'MyTool', tool_input: {} })
    expect(result.message).toBe('MyTool')
  })

  it('runs session lifecycle hooks', async () => {
    const config: HookConfig = {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'echo \'{"message":"started"}\'', timeout: 5000 }] }],
      },
    }
    const engine = new HookEngine(config)
    // SessionStart returns void but should not throw
    await expect(engine.runSessionStart({ session_id: 'test', cwd: '/tmp' })).resolves.not.toThrow()
  })
})
