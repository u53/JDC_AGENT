import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { EventEmitter } from 'node:events'

describe('codegraph/project', () => {
  let tmp: string
  beforeEach(() => { tmp = mkdtempSync(path.join(os.tmpdir(), 'cg-proj-')) })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
    vi.resetModules()
  })

  it('isInitialized returns false when no .codegraph/codegraph.db', async () => {
    const { isInitialized } = await import('../project.js')
    expect(isInitialized(tmp)).toBe(false)
  })

  it('isInitialized returns true when .codegraph/codegraph.db exists', async () => {
    mkdirSync(path.join(tmp, '.codegraph'), { recursive: true })
    writeFileSync(path.join(tmp, '.codegraph', 'codegraph.db'), '')
    const { isInitialized } = await import('../project.js')
    expect(isInitialized(tmp)).toBe(true)
  })

  it('init throws when binary unavailable', async () => {
    vi.doMock('../binary.js', () => ({
      resolveCodegraphBinary: () => null,
      isCodegraphAvailable: () => false,
    }))
    const { init } = await import('../project.js')
    expect(() => init(tmp)).toThrow(/binary/i)
  })

  it('init spawns binary with index args and resolves on exit 0', async () => {
    const fakeProc: any = new EventEmitter()
    fakeProc.stdout = new EventEmitter()
    fakeProc.stderr = new EventEmitter()
    fakeProc.kill = vi.fn()

    const spawnMock = vi.fn<(...args: any[]) => any>(() => fakeProc)
    vi.doMock('node:child_process', () => ({ spawn: spawnMock }))
    vi.doMock('../binary.js', () => ({
      resolveCodegraphBinary: () => '/fake/codegraph',
      isCodegraphAvailable: () => true,
    }))

    const { init } = await import('../project.js')
    const lines: string[] = []
    const p = init(tmp, line => lines.push(line))
    fakeProc.stdout.emit('data', Buffer.from('progress: 50/100\n'))
    fakeProc.emit('exit', 0, null)
    await p
    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [cmd, args] = spawnMock.mock.calls[0]
    expect(cmd).toBe('/fake/codegraph')
    expect(args).toEqual(['index', tmp])
    expect(lines.some(l => l.includes('progress'))).toBe(true)
  })

  it('init rejects on non-zero exit code', async () => {
    const fakeProc: any = new EventEmitter()
    fakeProc.stdout = new EventEmitter()
    fakeProc.stderr = new EventEmitter()
    fakeProc.kill = vi.fn()
    vi.doMock('node:child_process', () => ({ spawn: vi.fn(() => fakeProc) }))
    vi.doMock('../binary.js', () => ({
      resolveCodegraphBinary: () => '/fake/codegraph',
      isCodegraphAvailable: () => true,
    }))
    const { init } = await import('../project.js')
    const p = init(tmp)
    fakeProc.stderr.emit('data', Buffer.from('boom\n'))
    fakeProc.emit('exit', 2, null)
    await expect(p).rejects.toThrow(/exit code 2/)
  })
})
