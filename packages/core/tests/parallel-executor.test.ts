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

  it('should execute write tools serially in order', async () => {
    const registry = new ToolRegistry()
    const order: string[] = []

    registry.register({
      definition: { name: 'file_write', description: 'Write', inputSchema: { type: 'object', properties: {} } },
      execute: async (input) => {
        order.push(`start-${input.id}`)
        await new Promise(r => setTimeout(r, 30))
        order.push(`end-${input.id}`)
        return { content: `wrote-${input.id}` }
      },
    })

    const executor = new ParallelExecutor(createRunner(registry))
    const results = await executor.executeBatch(
      [
        { type: 'tool_use', id: 'w1', name: 'file_write', input: { id: '1' } },
        { type: 'tool_use', id: 'w2', name: 'file_write', input: { id: '2' } },
        { type: 'tool_use', id: 'w3', name: 'file_write', input: { id: '3' } },
      ],
      () => {}
    )

    // Serial: each starts only after previous ends
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3'])
    expect(results[0].content).toBe('wrote-1')
    expect(results[1].content).toBe('wrote-2')
    expect(results[2].content).toBe('wrote-3')
  })

  it('should execute reads before writes and preserve original order in results', async () => {
    const registry = new ToolRegistry()
    const execOrder: string[] = []

    registry.register({
      definition: { name: 'file_read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
      execute: async (input) => {
        execOrder.push(`read-${input.id}`)
        await new Promise(r => setTimeout(r, 20))
        return { content: `r-${input.id}` }
      },
    })
    registry.register({
      definition: { name: 'file_write', description: 'Write', inputSchema: { type: 'object', properties: {} } },
      execute: async (input) => {
        execOrder.push(`write-${input.id}`)
        return { content: `w-${input.id}` }
      },
    })

    const executor = new ParallelExecutor(createRunner(registry))
    // Mixed order: write, read, read, write
    const results = await executor.executeBatch(
      [
        { type: 'tool_use', id: 'a', name: 'file_write', input: { id: 'A' } },
        { type: 'tool_use', id: 'b', name: 'file_read', input: { id: 'B' } },
        { type: 'tool_use', id: 'c', name: 'file_read', input: { id: 'C' } },
        { type: 'tool_use', id: 'd', name: 'file_write', input: { id: 'D' } },
      ],
      () => {}
    )

    // Reads execute first (parallel), then writes (serial)
    expect(execOrder[0]).toBe('read-B')
    expect(execOrder[1]).toBe('read-C')
    expect(execOrder[2]).toBe('write-A')
    expect(execOrder[3]).toBe('write-D')

    // Results maintain original block order
    expect(results[0]).toEqual({ tool_use_id: 'a', content: 'w-A', is_error: false })
    expect(results[1]).toEqual({ tool_use_id: 'b', content: 'r-B', is_error: false })
    expect(results[2]).toEqual({ tool_use_id: 'c', content: 'r-C', is_error: false })
    expect(results[3]).toEqual({ tool_use_id: 'd', content: 'w-D', is_error: false })
  })

  it('should abort remaining tools when one fails', async () => {
    const registry = new ToolRegistry()
    const executed: string[] = []

    registry.register({
      definition: { name: 'file_read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
      execute: async (input, context) => {
        if (input.id === 'fail') {
          executed.push('fail')
          return { content: 'Error: not found', isError: true }
        }
        // Slow read — should be cancelled
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { executed.push(`done-${input.id}`); resolve(undefined) }, 200)
          context.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')) })
        })
        return { content: `ok-${input.id}` }
      },
    })
    registry.register({
      definition: { name: 'file_write', description: 'Write', inputSchema: { type: 'object', properties: {} } },
      execute: async (input) => {
        executed.push(`write-${input.id}`)
        return { content: `w-${input.id}` }
      },
    })

    const executor = new ParallelExecutor(createRunner(registry))
    const results = await executor.executeBatch(
      [
        { type: 'tool_use', id: 'r1', name: 'file_read', input: { id: 'fail' } },
        { type: 'tool_use', id: 'r2', name: 'file_read', input: { id: 'slow' } },
        { type: 'tool_use', id: 'w1', name: 'file_write', input: { id: 'X' } },
      ],
      () => {}
    )

    // The failing read should have aborted the slow read and the write
    expect(results[0].is_error).toBe(true)
    expect(results[0].content).toBe('Error: not found')
    // Slow read was cancelled (either aborted or cancelled message)
    expect(results[1].is_error).toBe(true)
    // Write was never started
    expect(results[2].is_error).toBe(true)
    expect(results[2].content).toBe('Cancelled: sibling tool failed')
    expect(executed).not.toContain('write-X')
  })

  it('should treat unknown tools as write (serial)', async () => {
    const registry = new ToolRegistry()
    const order: string[] = []

    registry.register({
      definition: { name: 'custom_tool', description: 'Custom', inputSchema: { type: 'object', properties: {} } },
      execute: async (input) => {
        order.push(`custom-${input.id}`)
        await new Promise(r => setTimeout(r, 20))
        return { content: `c-${input.id}` }
      },
    })

    const executor = new ParallelExecutor(createRunner(registry))
    const results = await executor.executeBatch(
      [
        { type: 'tool_use', id: 'x1', name: 'custom_tool', input: { id: '1' } },
        { type: 'tool_use', id: 'x2', name: 'custom_tool', input: { id: '2' } },
      ],
      () => {}
    )

    // Unknown tools run serially (treated as write)
    expect(order).toEqual(['custom-1', 'custom-2'])
    expect(results[0].is_error).toBe(false)
    expect(results[1].is_error).toBe(false)
  })

  it('should limit concurrency to 5', async () => {
    const registry = new ToolRegistry()
    let maxConcurrent = 0
    let current = 0

    registry.register({
      definition: { name: 'file_read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
      execute: async () => {
        current++
        if (current > maxConcurrent) maxConcurrent = current
        await new Promise(r => setTimeout(r, 50))
        current--
        return { content: 'ok' }
      },
    })

    const executor = new ParallelExecutor(createRunner(registry))
    // 10 reads — should never exceed 5 concurrent
    const blocks = Array.from({ length: 10 }, (_, i) => ({
      type: 'tool_use' as const,
      id: `r${i}`,
      name: 'file_read',
      input: {},
    }))

    await executor.executeBatch(blocks, () => {})

    expect(maxConcurrent).toBe(5)
  })

  it('should respect external abort signal', async () => {
    const registry = new ToolRegistry()

    registry.register({
      definition: { name: 'file_read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
      execute: async (_input, context) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 500)
          context.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')) })
        })
        return { content: 'ok' }
      },
    })

    const executor = new ParallelExecutor(createRunner(registry))
    const externalAbort = new AbortController()

    // Abort after 50ms
    setTimeout(() => externalAbort.abort(), 50)

    const results = await executor.executeBatch(
      [
        { type: 'tool_use', id: 'r1', name: 'file_read', input: {} },
        { type: 'tool_use', id: 'r2', name: 'file_read', input: {} },
      ],
      () => {},
      externalAbort.signal
    )

    // Both should be errors (aborted)
    expect(results[0].is_error).toBe(true)
    expect(results[1].is_error).toBe(true)
  })
})
