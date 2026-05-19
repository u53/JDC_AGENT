import { describe, it, expect, afterEach, vi } from 'vitest'
import { BackgroundTaskManager } from '../background-tasks.js'
import os from 'node:os'
import path from 'node:path'

describe('BackgroundTaskManager', () => {
  const mgr = new BackgroundTaskManager(path.join(os.tmpdir(), 'bg-tasks-test-' + Date.now()))

  afterEach(() => { mgr.stopAll() })

  it('spawns a background task and completes', async () => {
    const task = mgr.spawn('echo hello', '/tmp')
    expect(task.id).toBeDefined()
    expect(task.status).toBe('running')
    await new Promise(r => setTimeout(r, 500))
    const updated = mgr.getTask(task.id)
    expect(updated?.status).toBe('completed')
    expect(updated?.exitCode).toBe(0)
  })

  it('gets task output', async () => {
    const task = mgr.spawn('echo hello && echo world', '/tmp')
    await new Promise(r => setTimeout(r, 500))
    const output = mgr.getOutput(task.id)
    expect(output).toContain('hello')
    expect(output).toContain('world')
  })

  it('stops a running task', async () => {
    const task = mgr.spawn('sleep 60', '/tmp')
    expect(task.status).toBe('running')
    mgr.stop(task.id)
    await new Promise(r => setTimeout(r, 500))
    const updated = mgr.getTask(task.id)
    expect(updated?.status).toBe('failed')
  })

  it('lists running tasks', () => {
    const t1 = mgr.spawn('sleep 60', '/tmp')
    const t2 = mgr.spawn('sleep 60', '/tmp')
    const running = mgr.listRunning()
    expect(running.length).toBeGreaterThanOrEqual(2)
    mgr.stop(t1.id)
    mgr.stop(t2.id)
  })

  it('calls onComplete callback when shell task completes successfully', async () => {
    const cb = vi.fn()
    mgr.setOnComplete(cb)
    const task = mgr.spawn('echo done', '/tmp')
    await new Promise(r => setTimeout(r, 500))
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({
      id: task.id,
      status: 'completed',
      type: 'shell',
    }))
    mgr.setOnComplete(undefined)
  })

  it('calls onComplete callback when shell task fails', async () => {
    const cb = vi.fn()
    mgr.setOnComplete(cb)
    const task = mgr.spawn('exit 1', '/tmp')
    await new Promise(r => setTimeout(r, 500))
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({
      id: task.id,
      status: 'failed',
      type: 'shell',
    }))
    mgr.setOnComplete(undefined)
  })

  it('registers an agent task', () => {
    const task = mgr.registerAgent('summarize this file', 'research')
    expect(task.id).toBeDefined()
    expect(task.type).toBe('agent')
    expect(task.prompt).toBe('summarize this file')
    expect(task.agentType).toBe('research')
    expect(task.status).toBe('running')
  })

  it('completes an agent task', () => {
    const cb = vi.fn()
    mgr.setOnComplete(cb)
    const task = mgr.registerAgent('do something', 'coder')
    mgr.completeAgent(task.id, { turns: 3, toolsUsed: ['read', 'write'], result: 'done' })
    const updated = mgr.getTask(task.id)
    expect(updated?.status).toBe('completed')
    expect(updated?.result).toBe('done')
    expect(updated?.turns).toBe(3)
    expect(updated?.toolsUsed).toEqual(['read', 'write'])
    expect(updated?.completedAt).toBeDefined()
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ id: task.id, status: 'completed' }))
    mgr.setOnComplete(undefined)
  })

  it('fails an agent task', () => {
    const cb = vi.fn()
    mgr.setOnComplete(cb)
    const task = mgr.registerAgent('do something', 'coder')
    mgr.failAgent(task.id, 'timeout')
    const updated = mgr.getTask(task.id)
    expect(updated?.status).toBe('failed')
    expect(updated?.result).toBe('timeout')
    expect(updated?.completedAt).toBeDefined()
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ id: task.id, status: 'failed' }))
    mgr.setOnComplete(undefined)
  })

  it('listAll returns all tasks regardless of status or type', async () => {
    const shell = mgr.spawn('echo hi', '/tmp')
    const agent = mgr.registerAgent('test', 'research')
    await new Promise(r => setTimeout(r, 500))
    const all = mgr.listAll()
    expect(all.find(t => t.id === shell.id)).toBeDefined()
    expect(all.find(t => t.id === agent.id)).toBeDefined()
  })

  it('stop handles agent tasks by setting status to failed', () => {
    const task = mgr.registerAgent('long task', 'coder')
    mgr.stop(task.id)
    const updated = mgr.getTask(task.id)
    expect(updated?.status).toBe('failed')
  })

  it('shell tasks have type shell', () => {
    const task = mgr.spawn('echo hi', '/tmp')
    expect(task.type).toBe('shell')
  })

  it('queues agents when max concurrent reached', async () => {
    mgr.setMaxConcurrentAgents(1)
    const t1 = mgr.registerAgent('task 1', 'general')
    let slotAcquired = false
    mgr.acquireAgentSlot().then(() => { slotAcquired = true })
    await new Promise(r => setTimeout(r, 100))
    expect(slotAcquired).toBe(false)
    mgr.completeAgent(t1.id, { result: 'done', turns: 1, toolsUsed: [] })
    await new Promise(r => setTimeout(r, 100))
    expect(slotAcquired).toBe(true)
    mgr.setMaxConcurrentAgents(3)
  })
})
