import { describe, expect, it, vi } from 'vitest'
import { createAgentTool } from './agent.js'
import { runSubSession } from '../sub-session.js'
import { ToolRegistry } from '../tool-registry.js'

vi.mock('../sub-session.js', async () => {
  const actual = await vi.importActual<typeof import('../sub-session.js')>('../sub-session.js')
  return {
    ...actual,
    runSubSession: vi.fn(async () => ({ content: 'agent done', turns: 1, toolsUsed: [], status: 'completed' })),
  }
})

describe('Agent model resolution warnings', () => {
  it('includes resolver-provided model warnings when starting a background agent', async () => {
    const backgroundTasks = {
      registerAgent: vi.fn(() => ({ id: 'agent_task_1' })),
      acquireAgentSlot: vi.fn(async () => undefined),
      completeAgent: vi.fn(),
      failAgent: vi.fn(),
    }
    const tool = createAgentTool({
      provider: { name: 'main-provider' } as any,
      toolRegistry: new ToolRegistry(),
      modelConfig: { model: 'main-model', maxTokens: 32000, contextWindow: 200000 },
      cwd: '/repo',
      backgroundTasks: backgroundTasks as any,
      resolveModel: (() => ({
        status: 'failed' as const,
        warning: 'Configured model "claude-opus-4-1" is ambiguous. Use one of: official:claude-opus-4-1, proxy:claude-opus-4-1.',
      })) as any,
    })

    const result = await tool.execute({
      prompt: 'Investigate model resolution',
      modelId: 'claude-opus-4-1',
      run_in_background: true,
    }, { toolUseId: 'agent_tool_1' } as any)

    expect(result.content).toContain('Model warning:')
    expect(result.content).toContain('ambiguous')
    expect(result.content).toContain('official:claude-opus-4-1')
    await vi.waitFor(() => expect(runSubSession).toHaveBeenCalled())
  })

  it('marks background agents failed when the sub-session exhausts max turns', async () => {
    vi.mocked(runSubSession).mockResolvedValueOnce({
      content: '[Sub-agent reached max turns without final response]',
      turns: 25,
      toolsUsed: ['Read'],
      status: 'max_turns_exhausted',
    } as any)
    const backgroundTasks = {
      registerAgent: vi.fn(() => ({ id: 'agent_task_2' })),
      acquireAgentSlot: vi.fn(async () => undefined),
      completeAgent: vi.fn(),
      failAgent: vi.fn(),
    }
    const tool = createAgentTool({
      provider: { name: 'main-provider' } as any,
      toolRegistry: new ToolRegistry(),
      modelConfig: { model: 'main-model', maxTokens: 32000, contextWindow: 200000 },
      cwd: '/repo',
      backgroundTasks: backgroundTasks as any,
    })

    await tool.execute({
      prompt: 'Loop until max turns',
      run_in_background: true,
    }, { toolUseId: 'agent_tool_2' } as any)

    await vi.waitFor(() => expect(backgroundTasks.failAgent).toHaveBeenCalledWith(
      'agent_task_2',
      expect.stringContaining('max turns')
    ))
    expect(backgroundTasks.completeAgent).not.toHaveBeenCalled()
  })

  it('returns partial max-turn output without marking foreground Agent as an error', async () => {
    vi.mocked(runSubSession).mockResolvedValueOnce({
      content: 'Found VatReport in src/VatReport.java with fields id and amount.',
      turns: 300,
      toolsUsed: ['Grep', 'Read'],
      status: 'max_turns_exhausted',
    } as any)
    const tool = createAgentTool({
      provider: { name: 'main-provider' } as any,
      toolRegistry: new ToolRegistry(),
      modelConfig: { model: 'main-model', maxTokens: 32000, contextWindow: 200000 },
      cwd: '/repo',
    })

    const result = await tool.execute({
      prompt: 'Find DTO shape',
    }, { toolUseId: 'agent_tool_3' } as any)

    expect(result.isError).not.toBe(true)
    expect(result.content).toContain('Partial sub-agent result')
    expect(result.content).toContain('VatReport')
    expect(result.content).toContain('300 turns')
  })

  it('completes background agents with partial max-turn output when useful text exists', async () => {
    vi.mocked(runSubSession).mockResolvedValueOnce({
      content: 'Located DTO candidates but did not finish every tax type.',
      turns: 300,
      toolsUsed: ['Grep', 'Read'],
      status: 'max_turns_exhausted',
    } as any)
    const backgroundTasks = {
      registerAgent: vi.fn(() => ({ id: 'agent_task_3' })),
      acquireAgentSlot: vi.fn(async () => undefined),
      completeAgent: vi.fn(),
      failAgent: vi.fn(),
    }
    const tool = createAgentTool({
      provider: { name: 'main-provider' } as any,
      toolRegistry: new ToolRegistry(),
      modelConfig: { model: 'main-model', maxTokens: 32000, contextWindow: 200000 },
      cwd: '/repo',
      backgroundTasks: backgroundTasks as any,
    })

    await tool.execute({
      prompt: 'Long DTO analysis',
      run_in_background: true,
    }, { toolUseId: 'agent_tool_4' } as any)

    await vi.waitFor(() => expect(backgroundTasks.completeAgent).toHaveBeenCalledWith(
      'agent_task_3',
      expect.objectContaining({
        result: expect.stringContaining('Partial sub-agent result'),
        turns: 300,
        toolsUsed: ['Grep', 'Read'],
      })
    ))
    expect(backgroundTasks.failAgent).not.toHaveBeenCalled()
  })
})
