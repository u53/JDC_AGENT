import { describe, it, expect } from 'vitest'
import { getMatchingHooks } from '../loader.js'
import type { HookConfig } from '../types.js'

describe('getMatchingHooks', () => {
  const config: HookConfig = {
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo bash', timeout: 10000 }] },
        { matcher: '*', hooks: [{ type: 'command', command: 'echo all', timeout: 10000 }] },
        { matcher: 'mcp__*', hooks: [{ type: 'command', command: 'echo mcp', timeout: 10000 }] },
      ],
    },
  }

  it('matches exact tool name', () => {
    const rules = getMatchingHooks(config, 'PreToolUse', 'Bash')
    expect(rules).toHaveLength(2)
  })

  it('matches wildcard prefix', () => {
    const rules = getMatchingHooks(config, 'PreToolUse', 'mcp__github__search')
    expect(rules).toHaveLength(2)
  })

  it('matches only wildcard for unknown tool', () => {
    const rules = getMatchingHooks(config, 'PreToolUse', 'FileRead')
    expect(rules).toHaveLength(1)
  })

  it('returns all rules for events without matcher', () => {
    const cfg: HookConfig = {
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo start', timeout: 10000 }] }] },
    }
    const rules = getMatchingHooks(cfg, 'SessionStart')
    expect(rules).toHaveLength(1)
  })

  it('returns empty for unconfigured events', () => {
    const rules = getMatchingHooks(config, 'PostToolUse', 'Bash')
    expect(rules).toHaveLength(0)
  })
})
