import { describe, expect, it, vi } from 'vitest'
import { ParallelExecutor, type ToolUseBlock } from './parallel-executor.js'

describe('ParallelExecutor delegation fail-soft behavior', () => {
  it('does not cancel sibling Agent tools when one agent returns an error', async () => {
    const execute = vi.fn(async (_name: string, id: string) => {
      if (id === 'agent_1') return { content: 'Sub-agent error: max turns', isError: true }
      return { content: 'second agent completed', isError: false }
    })
    const executor = new ParallelExecutor({ execute } as any)
    const blocks: ToolUseBlock[] = [
      { type: 'tool_use', id: 'agent_1', name: 'Agent', input: { prompt: 'first' } },
      { type: 'tool_use', id: 'agent_2', name: 'Agent', input: { prompt: 'second' } },
    ]

    const results = await executor.executeBatch(blocks, vi.fn())

    expect(execute).toHaveBeenCalledTimes(2)
    expect(results[0]).toMatchObject({ tool_use_id: 'agent_1', is_error: true })
    expect(results[1]).toMatchObject({ tool_use_id: 'agent_2', content: 'second agent completed', is_error: false })
  })

  it('still cancels sibling writes after a normal write tool error', async () => {
    const execute = vi.fn(async (_name: string, id: string) => {
      if (id === 'write_1') return { content: 'write failed', isError: true }
      return { content: 'should not run', isError: false }
    })
    const executor = new ParallelExecutor({ execute } as any)
    const blocks: ToolUseBlock[] = [
      { type: 'tool_use', id: 'write_1', name: 'Write', input: { file_path: 'a.ts' } },
      { type: 'tool_use', id: 'edit_2', name: 'Edit', input: { file_path: 'b.ts' } },
    ]

    const results = await executor.executeBatch(blocks, vi.fn())

    expect(execute).toHaveBeenCalledTimes(1)
    expect(results[0]).toMatchObject({ tool_use_id: 'write_1', is_error: true })
    expect(results[1]).toMatchObject({
      tool_use_id: 'edit_2',
      content: 'Cancelled: sibling tool failed',
      is_error: true,
    })
  })

  it.each(['Edit', 'MultiEdit'])('does not apply the default startup timeout to %s', async (toolName) => {
    const timeoutController = new AbortController()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal)
    let resolveTool!: () => void
    const execute = vi.fn(async (name: string, id: string) => {
      await new Promise<void>(resolve => {
        resolveTool = resolve
      })
      return { content: `${name} ${id} completed`, isError: false }
    })
    const executor = new ParallelExecutor({ execute } as any)

    try {
      const promise = executor.executeBatch(
        [{ type: 'tool_use', id: 'mutation_1', name: toolName, input: { file_path: 'a.ts' } }],
        vi.fn(),
      )

      expect(execute).toHaveBeenCalledTimes(1)
      expect(timeoutSpy).not.toHaveBeenCalled()

      let settled = false
      promise.then(() => { settled = true })
      timeoutController.abort(new DOMException('timed out', 'TimeoutError'))
      await Promise.resolve()

      expect(settled).toBe(false)

      resolveTool()
      const results = await promise
      expect(results[0]).toEqual({
        tool_use_id: 'mutation_1',
        content: `${toolName} mutation_1 completed`,
        is_error: false,
      })
    } finally {
      timeoutSpy.mockRestore()
    }
  })
})
