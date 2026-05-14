import { describe, it, expect, afterEach } from 'vitest'
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
})
