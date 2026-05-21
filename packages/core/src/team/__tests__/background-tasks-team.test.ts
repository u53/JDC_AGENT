import { describe, it, expect, vi } from 'vitest'
import { BackgroundTaskManager } from '../../background-tasks.js'
import os from 'node:os'
import path from 'node:path'

describe('BackgroundTaskManager team support', () => {
  const mgr = new BackgroundTaskManager(path.join(os.tmpdir(), 'bg-team-test-' + Date.now()))

  it('registers a team task', () => {
    const task = mgr.registerTeam('Test objective', [{ role: 'explorer' }])
    expect(task.type).toBe('team')
    expect(task.status).toBe('running')
    expect(task.id).toBeDefined()
  })

  it('sends message to team mailbox', () => {
    const task = mgr.registerTeam('Test', [])
    mgr.sendMessage(task.id, { id: '1', from: 'user', to: 'manager', intent: 'hurry', content: 'Speed up', priority: 'high', createdAt: Date.now() })
    const msgs = mgr.getMailbox(task.id)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('Speed up')
  })

  it('drains mailbox clears messages', () => {
    const task = mgr.registerTeam('Test', [])
    mgr.sendMessage(task.id, { id: '1', from: 'user', to: 'manager', intent: 'message', content: 'hello', priority: 'normal', createdAt: Date.now() })
    const drained = mgr.drainMailbox(task.id)
    expect(drained).toHaveLength(1)
    expect(mgr.getMailbox(task.id)).toHaveLength(0)
  })

  it('emits and retrieves structured events', () => {
    const task = mgr.registerTeam('Test', [])
    mgr.emitEvent(task.id, { type: 'team_started', teamId: task.id, timestamp: Date.now() })
    mgr.emitEvent(task.id, { type: 'manager_decision', text: 'Planning', timestamp: Date.now() })
    const events = mgr.getEvents(task.id)
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe('team_started')
  })

  it('getEvents with tail returns last N', () => {
    const task = mgr.registerTeam('Test', [])
    for (let i = 0; i < 10; i++) {
      mgr.emitEvent(task.id, { type: 'manager_decision', text: `Decision ${i}`, timestamp: Date.now() })
    }
    const last3 = mgr.getEvents(task.id, 3)
    expect(last3).toHaveLength(3)
    expect((last3[0] as any).text).toBe('Decision 7')
  })

  it('completes a team', () => {
    const cb = vi.fn()
    mgr.setOnComplete(cb)
    const task = mgr.registerTeam('Test', [])
    mgr.completeTeam(task.id, { summary: 'Done' })
    const updated = mgr.getTask(task.id)
    expect(updated?.status).toBe('completed')
    expect(cb).toHaveBeenCalled()
  })

  it('fails a team', () => {
    const task = mgr.registerTeam('Test', [])
    mgr.failTeam(task.id, 'something went wrong')
    const updated = mgr.getTask(task.id)
    expect(updated?.status).toBe('failed')
    expect(updated?.result).toBe('something went wrong')
  })
})
