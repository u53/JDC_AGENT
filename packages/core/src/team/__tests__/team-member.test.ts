import { describe, it, expect, vi } from 'vitest'
import { TeamMember } from '../team-member.js'
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
      return { content: 'task complete', turns: 1, toolsUsed: ['file_read'] }
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
})
