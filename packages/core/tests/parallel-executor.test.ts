import { describe, it, expect, vi } from 'vitest'
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
      definition: { name: 'Read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
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
        { type: 'tool_use', id: 'a', name: 'Read', input: { id: '1' } },
        { type: 'tool_use', id: 'b', name: 'Read', input: { id: '2' } },
        { type: 'tool_use', id: 'c', name: 'Read', input: { id: '3' } },
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
      definition: { name: 'Write', description: 'Write', inputSchema: { type: 'object', properties: {} } },
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
        { type: 'tool_use', id: 'w1', name: 'Write', input: { id: '1' } },
        { type: 'tool_use', id: 'w2', name: 'Write', input: { id: '2' } },
        { type: 'tool_use', id: 'w3', name: 'Write', input: { id: '3' } },
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
      definition: { name: 'Read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
      execute: async (input) => {
        execOrder.push(`read-${input.id}`)
        await new Promise(r => setTimeout(r, 20))
        return { content: `r-${input.id}` }
      },
    })
    registry.register({
      definition: { name: 'Write', description: 'Write', inputSchema: { type: 'object', properties: {} } },
      execute: async (input) => {
        execOrder.push(`write-${input.id}`)
        return { content: `w-${input.id}` }
      },
    })

    const executor = new ParallelExecutor(createRunner(registry))
    // Mixed order: write, read, read, write
    const results = await executor.executeBatch(
      [
        { type: 'tool_use', id: 'a', name: 'Write', input: { id: 'A' } },
        { type: 'tool_use', id: 'b', name: 'Read', input: { id: 'B' } },
        { type: 'tool_use', id: 'c', name: 'Read', input: { id: 'C' } },
        { type: 'tool_use', id: 'd', name: 'Write', input: { id: 'D' } },
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

  it('should let read siblings finish when one read fails but skip writes', async () => {
    const registry = new ToolRegistry()
    const executed: string[] = []

    registry.register({
      definition: { name: 'Read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
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
      definition: { name: 'Write', description: 'Write', inputSchema: { type: 'object', properties: {} } },
      execute: async (input) => {
        executed.push(`write-${input.id}`)
        return { content: `w-${input.id}` }
      },
    })

    const executor = new ParallelExecutor(createRunner(registry))
    const results = await executor.executeBatch(
      [
        { type: 'tool_use', id: 'r1', name: 'Read', input: { id: 'fail' } },
        { type: 'tool_use', id: 'r2', name: 'Read', input: { id: 'slow' } },
        { type: 'tool_use', id: 'w1', name: 'Write', input: { id: 'X' } },
      ],
      () => {}
    )

    // Independent reads should still return useful results; writes are skipped
    // after a read failure so mutations do not proceed on incomplete context.
    expect(results[0].is_error).toBe(true)
    expect(results[0].content).toBe('Error: not found')
    expect(results[1].is_error).toBe(false)
    expect(results[1].content).toBe('ok-slow')
    // Write was never started
    expect(results[2].is_error).toBe(true)
    expect(results[2].content).toBe('Cancelled: sibling tool failed')
    expect(executed).not.toContain('write-X')
  })

  it('treats JDC engine tools as read-only siblings', async () => {
    const registry = new ToolRegistry()

    registry.register({
      definition: { name: 'Read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
      execute: async () => ({ content: 'Error: failed read', isError: true }),
    })
    registry.register({
      definition: { name: 'JdcNode', description: 'Symbol detail', inputSchema: { type: 'object', properties: {} } },
      execute: async () => {
        await new Promise(r => setTimeout(r, 20))
        return { content: 'symbol detail' }
      },
    })

    const executor = new ParallelExecutor(createRunner(registry))
    const results = await executor.executeBatch(
      [
        { type: 'tool_use', id: 'read', name: 'Read', input: {} },
        { type: 'tool_use', id: 'node', name: 'JdcNode', input: { symbol: 'runLoop' } },
      ],
      () => {}
    )

    expect(results[0]).toEqual({ tool_use_id: 'read', content: 'Error: failed read', is_error: true })
    expect(results[1]).toEqual({ tool_use_id: 'node', content: 'symbol detail', is_error: false })
  })

  it('does not let a JDC read-tool error cancel unrelated write siblings', async () => {
    const registry = new ToolRegistry()
    const executed: string[] = []

    registry.register({
      definition: { name: 'JdcContext', description: 'JDC context', inputSchema: { type: 'object', properties: {} } },
      execute: async () => ({ content: 'JDC ENGINE\nERROR\nsymbol lookup failed', isError: true }),
    })
    registry.register({
      definition: { name: 'Write', description: 'Write', inputSchema: { type: 'object', properties: {} } },
      execute: async (input) => {
        executed.push(`write-${input.id}`)
        return { content: `wrote-${input.id}` }
      },
    })

    const executor = new ParallelExecutor(createRunner(registry))
    const results = await executor.executeBatch(
      [
        { type: 'tool_use', id: 'jdc', name: 'JdcContext', input: { task: 'runLoop' } },
        { type: 'tool_use', id: 'write', name: 'Write', input: { id: 'X' } },
      ],
      () => {}
    )

    expect(results[0]).toEqual({ tool_use_id: 'jdc', content: 'JDC ENGINE\nERROR\nsymbol lookup failed', is_error: true })
    expect(results[1]).toEqual({ tool_use_id: 'write', content: 'wrote-X', is_error: false })
    expect(executed).toEqual(['write-X'])
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
      definition: { name: 'Read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
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
      name: 'Read',
      input: {},
    }))

    await executor.executeBatch(blocks, () => {})

    expect(maxConcurrent).toBe(5)
  })

  it('limits read tool concurrency from executor options', async () => {
    let active = 0
    let maxActive = 0
    const registry = new ToolRegistry()
    registry.register({
      definition: { name: 'Read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
      execute: async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise(resolve => setTimeout(resolve, 20))
        active -= 1
        return { content: 'ok' }
      },
    })
    const executor = new ParallelExecutor(createRunner(registry), { maxReadConcurrency: 2 })

    await executor.executeBatch([
      { type: 'tool_use', id: 'read_1', name: 'Read', input: {} },
      { type: 'tool_use', id: 'read_2', name: 'Read', input: {} },
      { type: 'tool_use', id: 'read_3', name: 'Read', input: {} },
      { type: 'tool_use', id: 'read_4', name: 'Read', input: {} },
    ], () => undefined)

    expect(maxActive).toBeLessThanOrEqual(2)
  })

  it('updates read tool concurrency after construction', async () => {
    let active = 0
    let maxActive = 0
    const registry = new ToolRegistry()
    registry.register({
      definition: { name: 'Read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
      execute: async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise(resolve => setTimeout(resolve, 20))
        active -= 1
        return { content: 'ok' }
      },
    })
    const executor = new ParallelExecutor(createRunner(registry))
    executor.setMaxReadConcurrency(1)

    await executor.executeBatch([
      { type: 'tool_use', id: 'read_1', name: 'Read', input: {} },
      { type: 'tool_use', id: 'read_2', name: 'Read', input: {} },
    ], () => undefined)

    expect(maxActive).toBe(1)
  })

  it('clamps configured read concurrency to the supported range', async () => {
    let active = 0
    let maxActive = 0
    const registry = new ToolRegistry()
    registry.register({
      definition: { name: 'Read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
      execute: async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise(resolve => setTimeout(resolve, 20))
        active -= 1
        return { content: 'ok' }
      },
    })
    const executor = new ParallelExecutor(createRunner(registry), { maxReadConcurrency: Number.POSITIVE_INFINITY })

    await executor.executeBatch([
      { type: 'tool_use', id: 'read_1', name: 'Read', input: {} },
      { type: 'tool_use', id: 'read_2', name: 'Read', input: {} },
      { type: 'tool_use', id: 'read_3', name: 'Read', input: {} },
      { type: 'tool_use', id: 'read_4', name: 'Read', input: {} },
      { type: 'tool_use', id: 'read_5', name: 'Read', input: {} },
      { type: 'tool_use', id: 'read_6', name: 'Read', input: {} },
    ], () => undefined)

    expect(maxActive).toBeLessThanOrEqual(5)
  })

  it('limits eager read tools across sibling batches', async () => {
    let active = 0
    let maxActive = 0
    const registry = new ToolRegistry()
    registry.register({
      definition: { name: 'Read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
      execute: async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise(resolve => setTimeout(resolve, 20))
        active -= 1
        return { content: 'ok' }
      },
    })
    registry.register({
      definition: { name: 'Write', description: 'Write', inputSchema: { type: 'object', properties: {} } },
      execute: async () => ({ content: 'write ok' }),
    })
    const executor = new ParallelExecutor(createRunner(registry), { maxReadConcurrency: 2 })

    await executor.executeBatch([
      { type: 'tool_use', id: 'read_1', name: 'Read', input: {} },
      { type: 'tool_use', id: 'write_1', name: 'Write', input: {} },
      { type: 'tool_use', id: 'read_2', name: 'Read', input: {} },
      { type: 'tool_use', id: 'read_3', name: 'Read', input: {} },
      { type: 'tool_use', id: 'read_4', name: 'Read', input: {} },
    ], () => undefined)

    expect(maxActive).toBeLessThanOrEqual(2)
  })

  it('should respect external abort signal', async () => {
    const registry = new ToolRegistry()

    registry.register({
      definition: { name: 'Read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
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
        { type: 'tool_use', id: 'r1', name: 'Read', input: {} },
        { type: 'tool_use', id: 'r2', name: 'Read', input: {} },
      ],
      () => {},
      externalAbort.signal
    )

    // Both should be errors (aborted)
    expect(results[0].is_error).toBe(true)
    expect(results[1].is_error).toBe(true)
  })

  it('does not apply the default short tool timeout to Team startup', async () => {
    const timeoutController = new AbortController()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal)
    try {
      const registry = new ToolRegistry()
      let resolveTeam!: () => void

      registry.register({
        definition: { name: 'Team', description: 'Team', inputSchema: { type: 'object', properties: {} } },
        execute: async () => {
          await new Promise<void>(resolve => {
            resolveTeam = resolve
          })
          return { content: 'team started' }
        },
      })

      const executor = new ParallelExecutor(createRunner(registry))
      const promise = executor.executeBatch(
        [{ type: 'tool_use', id: 'team1', name: 'Team', input: {} }],
        () => {}
      )

      timeoutController.abort()
      let settled = false
      promise.then(() => { settled = true })
      await Promise.resolve()

      expect(settled).toBe(false)

      resolveTeam()
      const results = await promise
      expect(results[0]).toEqual({ tool_use_id: 'team1', content: 'team started', is_error: false })
    } finally {
      timeoutSpy.mockRestore()
    }
  })
})
