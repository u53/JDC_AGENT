import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { SubSessionOptions, SubSessionResult } from '../../sub-session.js'

// Mock runSubSession to simulate quick member completion
vi.mock('../../sub-session.js', async () => {
  const actual = await vi.importActual<typeof import('../../sub-session.js')>('../../sub-session.js')
  return {
    ...actual,
    runSubSession: vi.fn(async (opts: SubSessionOptions): Promise<SubSessionResult> => {
      // Simulate completion immediately
      opts.onAgentText?.('Working on task')
      return { content: `Completed: ${opts.prompt.slice(0, 30)}`, turns: 1, toolsUsed: [] }
    }),
  }
})

import { TeamRuntime } from '../team-runtime.js'

let tmpDir: string
let mockDeps: any

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `team-runtime-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
  mockDeps = {
    provider: {} as any,
    toolRegistry: {} as any,
    modelConfig: {} as any,
    cwd: tmpDir,
  }
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('TeamRuntime', () => {
  it('initializes with correct status and members', () => {
    const team = new TeamRuntime({
      objective: 'Test',
      plan: {
        members: [{ role: 'explorer', agentType: 'explore' }],
        tasks: [{ title: 'A', description: 'do a' }],
      },
      subSessionDeps: mockDeps,
    })
    expect(team.getStatus()).toBe('planning')
    expect(team.getMembers()).toHaveLength(1)
  })

  it('caps members at 10', () => {
    const members = Array.from({ length: 15 }, (_, i) => ({ role: `m${i}`, agentType: 'explore' }))
    const team = new TeamRuntime({
      objective: 'Test',
      plan: {
        members,
        tasks: [],
      },
      subSessionDeps: mockDeps,
    })
    expect(team.getMembers()).toHaveLength(10)
  })

  it('creates one member per spec', () => {
    const team = new TeamRuntime({
      objective: 'Test',
      plan: {
        members: [
          { role: 'explorer A', responsibility: 'lane A', agentType: 'explore' },
          { role: 'explorer B', responsibility: 'lane B', agentType: 'explore' },
          { role: 'explorer C', responsibility: 'lane C', agentType: 'explore' },
        ],
        tasks: [],
      },
      subSessionDeps: mockDeps,
    })
    expect(team.getMembers()).toHaveLength(3)
  })

  it('start sets status to running and emits team_started event', async () => {
    const team = new TeamRuntime({
      objective: 'Test',
      plan: {
        members: [{ role: 'explorer', agentType: 'explore' }],
        tasks: [{ title: 'A', description: 'do a' }],
      },
      subSessionDeps: mockDeps,
    })
    await team.start()
    expect(team.getStatus()).toBe('running')
    const events = team.getEvents()
    expect(events.some(e => e.type === 'team_started')).toBe(true)
  })

  it('completes team after all tasks done', async () => {
    const onComplete = vi.fn()
    const team = new TeamRuntime({
      objective: 'Test',
      plan: {
        members: [{ role: 'explorer', agentType: 'explore' }],
        tasks: [{ title: 'A', description: 'do a' }],
      },
      subSessionDeps: mockDeps,
      onComplete,
    })
    await team.start()
    // Wait for microtasks and async work to settle
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(onComplete).toHaveBeenCalled()
    expect(team.getStatus()).toBe('completed')
  })

  it('handles wrap_up intervention', async () => {
    const onComplete = vi.fn()
    const team = new TeamRuntime({
      objective: 'Test',
      plan: {
        members: [{ role: 'explorer', agentType: 'explore' }],
        tasks: [
          { title: 'A', description: 'a' },
          { title: 'B', description: 'b' },
          { title: 'C', description: 'c' },
        ],
      },
      subSessionDeps: mockDeps,
      onComplete,
    })
    await team.start()
    team.sendMessage({
      id: '1', from: 'user', to: 'manager', intent: 'wrap_up',
      content: 'wrap up', priority: 'high', createdAt: Date.now(),
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    // After wrap_up, all remaining todo tasks should be cancelled and team complete
    const tasks = team.getTasks()
    const cancelledOrDone = tasks.filter(t => t.status === 'cancelled' || t.status === 'completed')
    expect(cancelledOrDone.length).toBe(tasks.length)
  })

  it('records events with ring buffer', async () => {
    const team = new TeamRuntime({
      objective: 'Test',
      plan: {
        members: [{ role: 'explorer', agentType: 'explore' }],
        tasks: [{ title: 'A', description: 'a' }],
      },
      subSessionDeps: mockDeps,
    })
    await team.start()
    await new Promise(resolve => setTimeout(resolve, 50))
    const events = team.getEvents()
    expect(events.length).toBeGreaterThan(0)
    expect(events.some(e => e.type === 'team_started')).toBe(true)
    expect(events.some(e => e.type === 'task_created')).toBe(true)
  })

  it('stop aborts all members', () => {
    const team = new TeamRuntime({
      objective: 'Test',
      plan: {
        members: [{ role: 'a', agentType: 'explore' }, { role: 'b', agentType: 'explore' }],
        tasks: [],
      },
      subSessionDeps: mockDeps,
    })
    team.stop()
    expect(team.getStatus()).toBe('stopped')
  })
})
