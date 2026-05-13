import { describe, it, expect } from 'vitest'
import { HookEngine } from '../engine.js'
import { ToolRunner } from '../../tool-runner.js'
import { ToolRegistry } from '../../tool-registry.js'
import { PermissionChecker } from '../../permissions.js'

describe('ToolRunner + Hooks integration', () => {
  it('blocks tool execution when hook returns block', async () => {
    const config = {
      hooks: {
        PreToolUse: [{ matcher: 'TestTool', hooks: [{ type: 'command' as const, command: "echo '{\"decision\":\"block\",\"reason\":\"denied\"}'", timeout: 5000 }] }],
      },
    }
    const engine = new HookEngine(config)
    const registry = new ToolRegistry()
    registry.register({
      definition: { name: 'TestTool', description: 'test', inputSchema: { type: 'object', properties: {} } },
      execute: async () => ({ content: 'ok' }),
    })
    const permissions = new PermissionChecker('relaxed')
    const runner = new ToolRunner(registry, '/tmp', permissions, undefined, engine, 'test-session')
    const events: any[] = []
    const result = await runner.execute('TestTool', 'id1', {}, (e) => events.push(e))
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Blocked by hook')
  })

  it('allows tool execution when hook returns allow', async () => {
    const config = {
      hooks: {
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command' as const, command: "echo '{\"decision\":\"allow\"}'", timeout: 5000 }] }],
      },
    }
    const engine = new HookEngine(config)
    const registry = new ToolRegistry()
    registry.register({
      definition: { name: 'TestTool', description: 'test', inputSchema: { type: 'object', properties: {} } },
      execute: async () => ({ content: 'success' }),
    })
    const permissions = new PermissionChecker('relaxed')
    const runner = new ToolRunner(registry, '/tmp', permissions, undefined, engine, 'test-session')
    const events: any[] = []
    const result = await runner.execute('TestTool', 'id1', {}, (e) => events.push(e))
    expect(result.isError).toBeUndefined()
    expect(result.content).toBe('success')
  })

  it('works without hook engine (backward compatible)', async () => {
    const registry = new ToolRegistry()
    registry.register({
      definition: { name: 'TestTool', description: 'test', inputSchema: { type: 'object', properties: {} } },
      execute: async () => ({ content: 'ok' }),
    })
    const permissions = new PermissionChecker('relaxed')
    const runner = new ToolRunner(registry, '/tmp', permissions)
    const events: any[] = []
    const result = await runner.execute('TestTool', 'id1', {}, (e) => events.push(e))
    expect(result.content).toBe('ok')
  })
})
