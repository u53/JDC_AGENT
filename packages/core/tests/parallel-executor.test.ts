import { describe, it, expect } from 'vitest'
import { ParallelExecutor } from '../src/parallel-executor.js'
import { ToolRegistry } from '../src/tool-registry.js'
import { ToolRunner } from '../src/tool-runner.js'
import { PermissionChecker } from '../src/permissions.js'

function createRunner(registry: ToolRegistry) {
  return new ToolRunner(registry, '/tmp', new PermissionChecker('relaxed'))
}

describe('ParallelExecutor', () => {
  it('should execute read-only tools in parallel', async () => {
    const registry = new ToolRegistry()
    const order: string[] = []

    registry.register({
      definition: { name: 'file_read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
      execute: async (input) => {
        order.push(`start-${input.id}`)
        await new Promise(r => setTimeout(r, 50))
        order.push(`end-${input.id}`)
        return { content: `read-${input.id}` }
      },
    })

    const executor = new ParallelExecutor(createRunner(registry))
    const events: any[] = []

    const results = await executor.executeBatch(
      [
        { type: 'tool_use', id: 'a', name: 'file_read', input: { id: '1' } },
        { type: 'tool_use', id: 'b', name: 'file_read', input: { id: '2' } },
        { type: 'tool_use', id: 'c', name: 'file_read', input: { id: '3' } },
      ],
      (e) => events.push(e)
    )

    // All 3 should start before any ends (parallel)
    expect(order.slice(0, 3)).toEqual(['start-1', 'start-2', 'start-3'])
    // Results maintain original order
    expect(results).toHaveLength(3)
    expect(results[0]).toEqual({ tool_use_id: 'a', content: 'read-1', is_error: false })
    expect(results[1]).toEqual({ tool_use_id: 'b', content: 'read-2', is_error: false })
    expect(results[2]).toEqual({ tool_use_id: 'c', content: 'read-3', is_error: false })
  })
})
