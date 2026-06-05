import { describe, it, expect, vi } from 'vitest'
import { TeamMember } from '../team-member.js'
import { runSubSession } from '../../sub-session.js'
import type { SubSessionOptions, SubSessionResult } from '../../sub-session.js'

// Mock runSubSession
vi.mock('../../sub-session.js', async () => {
  const actual = await vi.importActual<typeof import('../../sub-session.js')>('../../sub-session.js')
  return {
    ...actual,
    runSubSession: vi.fn(async (opts: SubSessionOptions): Promise<SubSessionResult> => {
      // Simulate calling onAgentProgress
      opts.onAgentProgress?.({ toolName: 'file_read', toolStatus: 'start', toolCount: 1 })
      opts.onAgentProgress?.({ toolName: 'file_read', toolStatus: 'complete', toolCount: 1 })
      opts.onAgentText?.('Hello world')
      return { content: 'task complete', turns: 1, toolsUsed: ['file_read'], status: 'completed' }
    }),
  }
})

const mockDeps: any = {
  provider: {} as any,
  toolRegistry: {} as any,
  modelConfig: {} as any,
  cwd: '/tmp',
}

describe('TeamMember', () => {
  it('initializes with queued status', () => {
    const member = new TeamMember({
      spec: { role: 'explorer' },
      taskPrompt: 'Find auth code',
      subSessionDeps: mockDeps,
    })
    expect(member.getStatus()).toBe('queued')
  })

  it('derives id, role, agentType from spec', () => {
    const member = new TeamMember({
      spec: { role: 'security-reviewer', agentType: 'security-auditor' },
      taskPrompt: 'Audit',
      subSessionDeps: mockDeps,
    })
    expect(member.id).toMatch(/^member_/)
    expect(member.role).toBe('security-reviewer')
    expect(member.agentType).toBe('security-auditor')
  })

  it('runs task and emits events', async () => {
    const events: any[] = []
    const member = new TeamMember({
      spec: { role: 'explorer', agentType: 'explore' },
      taskPrompt: 'Find auth code',
      subSessionDeps: mockDeps,
      onEvent: (e) => events.push(e),
    })
    await member.start()
    expect(member.getStatus()).toBe('completed')
    expect(events.some(e => e.type === 'tool_start')).toBe(true)
    expect(events.some(e => e.type === 'tool_complete')).toBe(true)
    expect(events.some(e => e.type === 'member_progress')).toBe(true)
  })

  it('calls onComplete with result', async () => {
    const onComplete = vi.fn()
    const member = new TeamMember({
      spec: { role: 'explorer', agentType: 'explore' },
      taskPrompt: 'task',
      subSessionDeps: mockDeps,
      onComplete,
    })
    await member.start()
    expect(onComplete).toHaveBeenCalledWith(member.id, expect.objectContaining({ summary: 'task complete' }))
  })

  it('fails instead of completing when the sub-session exhausts max turns', async () => {
    vi.mocked(runSubSession).mockResolvedValueOnce({
      content: '[Sub-agent reached max turns without final response]',
      turns: 25,
      toolsUsed: ['Read'],
      status: 'max_turns_exhausted',
    } as any)
    const onComplete = vi.fn()
    const onFail = vi.fn()
    const member = new TeamMember({
      spec: { role: 'explorer', agentType: 'explore' },
      taskPrompt: 'task',
      subSessionDeps: mockDeps,
      onComplete,
      onFail,
    })

    await member.start()

    expect(member.getStatus()).toBe('failed')
    expect(onComplete).not.toHaveBeenCalled()
    expect(onFail).toHaveBeenCalledWith(member.id, expect.stringContaining('max turns'))
  })

  it('passes team worker actor metadata to the sub-session context engine', async () => {
    vi.mocked(runSubSession).mockClear()
    const member = new TeamMember({
      spec: { role: 'api worker', agentType: 'general' },
      taskPrompt: 'Update src/api/checkout.ts and keep package.json unchanged.',
      taskId: 'task_checkout',
      teamId: 'team_alpha',
      teamObjective: 'Fix checkout flow',
      id: 'member_api',
      subSessionDeps: mockDeps,
    })

    await member.start()

    expect(runSubSession).toHaveBeenCalledWith(expect.objectContaining({
      contextActor: 'team_worker',
      teamId: 'team_alpha',
      memberId: 'member_api',
      taskId: 'task_checkout',
      parentObjective: 'Fix checkout flow',
      fileScope: expect.arrayContaining(['src/api/checkout.ts']),
    }))
  })

  it('sendMessage adds to mailbox', () => {
    const member = new TeamMember({
      spec: { role: 'explorer' },
      taskPrompt: 'task',
      subSessionDeps: mockDeps,
    })
    expect(member.getMailboxLength()).toBe(0)
    member.sendMessage({
      id: '1', from: 'manager', to: `member:${member.id}`,
      intent: 'hurry', content: 'speed up', priority: 'high', createdAt: Date.now(),
    })
    expect(member.getMailboxLength()).toBe(1)
  })

  it('abort sets status to stopped', () => {
    const member = new TeamMember({
      spec: { role: 'explorer' },
      taskPrompt: 'task',
      subSessionDeps: mockDeps,
    })
    member.abort()
    expect(member.getStatus()).toBe('stopped')
  })

  it('getState returns full member state', () => {
    const member = new TeamMember({
      spec: { role: 'explorer', agentType: 'explore' },
      taskPrompt: 'task',
      subSessionDeps: mockDeps,
    })
    const state = member.getState()
    expect(state.id).toBe(member.id)
    expect(state.role).toBe('explorer')
    expect(state.agentType).toBe('explore')
    expect(state.capabilities).toContain('read')
    expect(state.toolCount).toBe(0)
  })

  it('write-capable agent has write capability', () => {
    const member = new TeamMember({
      spec: { role: 'implementer', agentType: 'general' },
      taskPrompt: 'task',
      subSessionDeps: mockDeps,
    })
    expect(member.getState().capabilities).toContain('write')
    expect(member.getState().capabilities).toContain('shell')
  })

  it('emits model_resolution_warning when modelId cannot be resolved', async () => {
    const events: any[] = []
    const member = new TeamMember({
      spec: { role: 'worker', modelId: 'missing-model' },
      taskPrompt: 'task',
      subSessionDeps: mockDeps,
      resolveModel: () => ({ status: 'failed', warning: 'Requested model "missing-model" not found — falling back to main session model' }),
      onEvent: (e) => events.push(e),
    })
    await member.start()
    const warn = events.find(e => e.type === 'model_resolution_warning')
    expect(warn).toBeDefined()
    expect(warn.requestedModelId).toBe('missing-model')
    expect(warn.message).toContain('not found')
  })

  it('emits the resolver-provided warning when modelId resolution fails with details', async () => {
    const events: any[] = []
    const member = new TeamMember({
      spec: { role: 'worker', modelId: 'claude-opus-4-1' },
      taskPrompt: 'task',
      subSessionDeps: mockDeps,
      resolveModel: (() => ({
        status: 'failed' as const,
        warning: 'Configured model "claude-opus-4-1" is ambiguous. Use one of: official:claude-opus-4-1, proxy:claude-opus-4-1.',
      })) as any,
      onEvent: (e) => events.push(e),
    })
    await member.start()
    const warn = events.find(e => e.type === 'model_resolution_warning')
    expect(warn).toBeDefined()
    expect(warn.message).toContain('ambiguous')
    expect(warn.message).toContain('official:claude-opus-4-1')
    expect(runSubSession).toHaveBeenLastCalledWith(expect.objectContaining({
      provider: mockDeps.provider,
      modelConfig: mockDeps.modelConfig,
    }))
  })
})
