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
    expect(args).toEqual(['init', tmp, '--index'])
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

  // ---- forceReindex ----

  it('forceReindex throws when binary unavailable', async () => {
    vi.doMock('../binary.js', () => ({
      resolveCodegraphBinary: () => null,
      isCodegraphAvailable: () => false,
    }))
    const { forceReindex } = await import('../project.js')
    expect(() => forceReindex(tmp)).toThrow(/binary/i)
  })

  it('forceReindex spawns with --force and resolves on exit 0', async () => {
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

    const { forceReindex } = await import('../project.js')
    const lines: string[] = []
    const p = forceReindex(tmp, line => lines.push(line))
    fakeProc.stdout.emit('data', Buffer.from('reindex: 50/100\n'))
    fakeProc.emit('exit', 0, null)
    await p
    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [cmd, args] = spawnMock.mock.calls[0]
    expect(cmd).toBe('/fake/codegraph')
    expect(args).toEqual(['index', tmp, '--force'])
    expect(lines.some(l => l.includes('reindex'))).toBe(true)
  })

  it('forceReindex rejects on non-zero exit code', async () => {
    const fakeProc: any = new EventEmitter()
    fakeProc.stdout = new EventEmitter()
    fakeProc.stderr = new EventEmitter()
    fakeProc.kill = vi.fn()
    vi.doMock('node:child_process', () => ({ spawn: vi.fn(() => fakeProc) }))
    vi.doMock('../binary.js', () => ({
      resolveCodegraphBinary: () => '/fake/codegraph',
      isCodegraphAvailable: () => true,
    }))
    const { forceReindex } = await import('../project.js')
    const p = forceReindex(tmp)
    fakeProc.stderr.emit('data', Buffer.from('fatal error\n'))
    fakeProc.emit('exit', 1, null)
    await expect(p).rejects.toThrow(/exit code 1/)
  })

  it('forceReindex cancel() sends SIGTERM', async () => {
    const fakeProc: any = new EventEmitter()
    fakeProc.stdout = new EventEmitter()
    fakeProc.stderr = new EventEmitter()
    fakeProc.kill = vi.fn()
    vi.doMock('node:child_process', () => ({ spawn: vi.fn(() => fakeProc) }))
    vi.doMock('../binary.js', () => ({
      resolveCodegraphBinary: () => '/fake/codegraph',
      isCodegraphAvailable: () => true,
    }))
    const { forceReindex } = await import('../project.js')
    const p = forceReindex(tmp)
    p.cancel()
    expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM')
  })

  // ---- getStatus ----

  it('getStatus returns null when project is not initialized', async () => {
    const { getStatus } = await import('../project.js')
    const result = await getStatus(tmp)
    expect(result).toBeNull()
  })

  it('getStatus parses --json output and returns CodegraphProjectStatus', async () => {
    mkdirSync(path.join(tmp, '.codegraph'), { recursive: true })
    writeFileSync(path.join(tmp, '.codegraph', 'codegraph.db'), '')

    const fakeProc: any = new EventEmitter()
    fakeProc.stdout = new EventEmitter()
    fakeProc.stderr = new EventEmitter()
    fakeProc.kill = vi.fn()
    vi.doMock('node:child_process', () => ({ spawn: vi.fn(() => fakeProc) }))
    vi.doMock('../binary.js', () => ({
      resolveCodegraphBinary: () => '/fake/codegraph',
      isCodegraphAvailable: () => true,
    }))
    const { getStatus } = await import('../project.js')
    const p = getStatus(tmp)
    fakeProc.stdout.emit('data', Buffer.from('{"symbols": 1234, "lastIndexed": 1717000000}\n'))
    fakeProc.emit('exit', 0, null)
    const result = await p
    expect(result).toEqual({ symbols: 1234, lastIndexed: 1717000000 })
  })

  it('getStatus returns null on JSON parse failure', async () => {
    mkdirSync(path.join(tmp, '.codegraph'), { recursive: true })
    writeFileSync(path.join(tmp, '.codegraph', 'codegraph.db'), '')

    const fakeProc: any = new EventEmitter()
    fakeProc.stdout = new EventEmitter()
    fakeProc.stderr = new EventEmitter()
    fakeProc.kill = vi.fn()
    vi.doMock('node:child_process', () => ({ spawn: vi.fn(() => fakeProc) }))
    vi.doMock('../binary.js', () => ({
      resolveCodegraphBinary: () => '/fake/codegraph',
      isCodegraphAvailable: () => true,
    }))
    const { getStatus } = await import('../project.js')
    const p = getStatus(tmp)
    fakeProc.stdout.emit('data', Buffer.from('not json at all\n'))
    fakeProc.emit('exit', 0, null)
    const result = await p
    expect(result).toBeNull()
  })
})
