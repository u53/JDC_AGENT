import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanLockfiles, isLockfileValid, matchesWorkspace, removeStaleLockfile } from '../src/ide/lockfile.js'

const TEST_DIR = join(tmpdir(), 'jdcagnet-ide-test-' + process.pid)

beforeEach(() => { mkdirSync(TEST_DIR, { recursive: true }) })
afterEach(() => { rmSync(TEST_DIR, { recursive: true, force: true }) })

describe('scanLockfiles', () => {
  it('reads valid lockfiles', () => {
    writeFileSync(join(TEST_DIR, '9000.lock'), JSON.stringify({
      workspaceFolders: ['/project'],
      pid: process.pid,
      ideName: 'VS Code',
      authToken: 'abc',
      version: '0.1.0',
      timestamp: Date.now(),
    }))
    const results = scanLockfiles(TEST_DIR)
    expect(results).toHaveLength(1)
    expect(results[0].port).toBe(9000)
    expect(results[0].lockfile.ideName).toBe('VS Code')
  })

  it('skips malformed lockfiles', () => {
    writeFileSync(join(TEST_DIR, '9001.lock'), 'not json')
    const results = scanLockfiles(TEST_DIR)
    expect(results).toHaveLength(0)
  })

  it('extracts port from filename', () => {
    writeFileSync(join(TEST_DIR, '12345.lock'), JSON.stringify({
      workspaceFolders: ['/project'],
      pid: process.pid,
      ideName: 'IDEA',
      authToken: 'xyz',
      version: '0.1.0',
      timestamp: Date.now(),
    }))
    const results = scanLockfiles(TEST_DIR)
    expect(results[0].port).toBe(12345)
  })
})

describe('isLockfileValid', () => {
  it('returns true for current process pid', () => {
    expect(isLockfileValid({ pid: process.pid, workspaceFolders: ['/p'], ideName: 'VS Code', authToken: 'a', version: '0.1.0', timestamp: 0 })).toBe(true)
  })

  it('returns false for dead pid', () => {
    expect(isLockfileValid({ pid: 999999999, workspaceFolders: ['/p'], ideName: 'VS Code', authToken: 'a', version: '0.1.0', timestamp: 0 })).toBe(false)
  })
})

describe('matchesWorkspace', () => {
  it('matches exact path', () => {
    const lockfile = { workspaceFolders: ['/Users/user/project'], pid: 1, ideName: 'VS Code', authToken: 'a', version: '0.1.0', timestamp: 0 }
    expect(matchesWorkspace(lockfile, '/Users/user/project')).toBe(true)
  })

  it('matches subdirectory', () => {
    const lockfile = { workspaceFolders: ['/Users/user/project'], pid: 1, ideName: 'VS Code', authToken: 'a', version: '0.1.0', timestamp: 0 }
    expect(matchesWorkspace(lockfile, '/Users/user/project/src')).toBe(true)
  })

  it('does not match unrelated path', () => {
    const lockfile = { workspaceFolders: ['/Users/user/project'], pid: 1, ideName: 'VS Code', authToken: 'a', version: '0.1.0', timestamp: 0 }
    expect(matchesWorkspace(lockfile, '/Users/user/other')).toBe(false)
  })
})

describe('removeStaleLockfile', () => {
  it('deletes the file', () => {
    const f = join(TEST_DIR, '8000.lock')
    writeFileSync(f, '{}')
    removeStaleLockfile(f)
    expect(existsSync(f)).toBe(false)
  })
})
