import { describe, it, expect } from 'vitest'
import { TeamManager } from '../team-manager.js'

describe('TeamManager', () => {
  it('creates initial tasks with todo status', () => {
    const mgr = new TeamManager({
      initialTasks: [
        { title: 'Task A', description: 'do a' },
        { title: 'Task B', description: 'do b' },
      ],
    })
    expect(mgr.getTasks()).toHaveLength(2)
    expect(mgr.getTasks()[0].status).toBe('todo')
  })

  it('returns runnable tasks (no deps or deps completed)', () => {
    const mgr = new TeamManager({
      initialTasks: [
        { title: 'A', description: 'a' },
        { title: 'B', description: 'b' },
      ],
    })
    const runnable = mgr.getRunnableTasks()
    expect(runnable).toHaveLength(2)
  })

  it('honors task dependencies', () => {
    const mgr = new TeamManager({
      initialTasks: [
        { title: 'A', description: 'a' },
      ],
    })
    const taskA = mgr.getTasks()[0]
    // Add task B depending on A by constructing fresh
    const mgr2 = new TeamManager({
      initialTasks: [
        { title: 'A', description: 'a' },
      ],
    })
    // Actually test with new instance and prepared deps
    const mgr3 = new TeamManager({
      initialTasks: [
        { title: 'A', description: 'a' },
      ],
    })
    const aId = mgr3.getTasks()[0].id
    // Manually set up by adding a second through internal API:
    // For this test we mock by checking an instance with a dependsOn that doesn't exist
    const mgr4 = new TeamManager({
      initialTasks: [
        { title: 'A', description: 'a' },
        { title: 'B', description: 'b', dependsOn: ['nonexistent'] },
      ],
    })
    // B depends on nonexistent (never completed), so only A is runnable
    expect(mgr4.getRunnableTasks().map(t => t.title)).toEqual(['A'])
  })

  it('decideTick assigns tasks to available members', () => {
    const mgr = new TeamManager({
      initialTasks: [
        { title: 'A', description: 'a' },
        { title: 'B', description: 'b' },
      ],
    })
    const actions = mgr.decideTick(0, ['m1', 'm2'])
    expect(actions.filter(a => a.type === 'assign_task')).toHaveLength(2)
  })

  it('decideTick prioritizes urgent tasks', () => {
    const mgr = new TeamManager({
      initialTasks: [
        { title: 'low', description: '', priority: 'low' },
        { title: 'urgent', description: '', priority: 'urgent' },
        { title: 'normal', description: '', priority: 'normal' },
      ],
    })
    const actions = mgr.decideTick(0, ['m1'])
    const assigned = actions.find(a => a.type === 'assign_task')!
    const task = mgr.getTask(assigned.taskId!)!
    expect(task.title).toBe('urgent')
  })

  it('marks task completed and records result', () => {
    const mgr = new TeamManager({ initialTasks: [{ title: 'A', description: 'a' }] })
    const taskId = mgr.getTasks()[0].id
    mgr.markTaskCompleted(taskId, { summary: 'done', findings: [] })
    expect(mgr.getTask(taskId)!.status).toBe('completed')
    expect(mgr.getTask(taskId)!.result?.summary).toBe('done')
  })

  it('decideTick returns complete action when all tasks done', () => {
    const mgr = new TeamManager({ initialTasks: [{ title: 'A', description: 'a' }] })
    const taskId = mgr.getTasks()[0].id
    mgr.markTaskCompleted(taskId, { summary: 'done', findings: [] })
    const actions = mgr.decideTick(0, [])
    expect(actions.some(a => a.type === 'complete')).toBe(true)
  })

  it('handles wrap_up intervention by cancelling todo tasks', () => {
    const mgr = new TeamManager({
      initialTasks: [
        { title: 'A', description: 'a' },
        { title: 'B', description: 'b' },
      ],
    })
    const actions = mgr.handleIntervention({
      id: '1', from: 'user', to: 'manager', intent: 'wrap_up',
      content: 'wrap up', priority: 'high', createdAt: Date.now(),
    })
    expect(mgr.isWrapUpRequested()).toBe(true)
    expect(mgr.getTasks().every(t => t.status === 'cancelled')).toBe(true)
    expect(actions.some(a => a.type === 'broadcast')).toBe(true)
  })

  it('handles hurry intervention by broadcasting', () => {
    const mgr = new TeamManager({ initialTasks: [{ title: 'A', description: 'a' }] })
    const actions = mgr.handleIntervention({
      id: '1', from: 'user', to: 'manager', intent: 'hurry',
      content: 'speed up', priority: 'high', createdAt: Date.now(),
    })
    expect(actions.some(a => a.type === 'broadcast' && a.intent === 'hurry')).toBe(true)
  })

  it('handles direct member message via member:xxx target', () => {
    const mgr = new TeamManager({ initialTasks: [] })
    const actions = mgr.handleIntervention({
      id: '1', from: 'user', to: 'member:m_abc', intent: 'message',
      content: 'hello m_abc', priority: 'normal', createdAt: Date.now(),
    })
    expect(actions[0].type).toBe('send_member_message')
    expect(actions[0].memberId).toBe('m_abc')
  })

  it('synthesize includes completed and failed task counts', () => {
    const mgr = new TeamManager({
      initialTasks: [
        { title: 'A', description: 'a' },
        { title: 'B', description: 'b' },
      ],
    })
    const ids = mgr.getTasks().map(t => t.id)
    mgr.markTaskCompleted(ids[0], { summary: 'A done', findings: [] })
    mgr.markTaskFailed(ids[1], 'oops')
    const text = mgr.synthesize()
    expect(text).toContain('Tasks completed: 1')
    expect(text).toContain('Tasks failed: 1')
    expect(text).toContain('A done')
  })
})
