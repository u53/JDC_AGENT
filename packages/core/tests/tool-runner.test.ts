import { describe, it, expect } from 'vitest'
import { ToolRegistry } from '../src/tool-registry.js'
import { ToolRunner } from '../src/tool-runner.js'
import { PermissionChecker } from '../src/permissions.js'

describe('ToolRunner', () => {
  it('should execute a registered tool', async () => {
    const registry = new ToolRegistry()
    registry.register({
      definition: { name: 'echo', description: 'Echo input', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
      execute: async (input) => ({ content: String(input.text) }),
    })

    const runner = new ToolRunner(registry, '/tmp', new PermissionChecker('relaxed'))
    const events: any[] = []
    const result = await runner.execute('echo', 'id-1', { text: 'hello' }, (e) => events.push(e))

    expect(result.content).toBe('hello')
    expect(events[0].type).toBe('start')
    expect(events[0].input).toEqual({ text: 'hello' })
    expect(events[1].type).toBe('complete')
  })

  it('should return error for unknown tool', async () => {
    const registry = new ToolRegistry()
    const runner = new ToolRunner(registry, '/tmp', new PermissionChecker('relaxed'))
    const events: any[] = []
    const result = await runner.execute('unknown', 'id-2', {}, (e) => events.push(e))

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Unknown tool')
  })

  it('should catch execution errors', async () => {
    const registry = new ToolRegistry()
    registry.register({
      definition: { name: 'fail', description: 'Always fails', inputSchema: {} },
      execute: async () => { throw new Error('boom') },
    })

    const runner = new ToolRunner(registry, '/tmp', new PermissionChecker('relaxed'))
    const events: any[] = []
    const result = await runner.execute('fail', 'id-3', {}, (e) => events.push(e))

    expect(result.isError).toBe(true)
    expect(result.content).toBe('boom')
    expect(events[1].type).toBe('error')
  })
})
