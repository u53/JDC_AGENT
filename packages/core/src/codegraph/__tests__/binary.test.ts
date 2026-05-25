import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('resolveCodegraphBinary', () => {
  let tmp: string
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'codegraph-bin-'))
    originalEnv = { ...process.env }
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
    process.env = originalEnv
    vi.resetModules()
  })

  it('finds binary under packages/electron/resources/codegraph (project root cwd)', async () => {
    const hostKey = `${process.platform === 'win32' ? 'win32' : process.platform}-${process.arch}`
    const dir = path.join(tmp, 'packages', 'electron', 'resources', 'codegraph', hostKey, 'bin')
    mkdirSync(dir, { recursive: true })
    const binName = process.platform === 'win32' ? 'codegraph.exe' : 'codegraph'
    const file = path.join(dir, binName)
    writeFileSync(file, '#!/bin/sh\necho 0\n')
    if (process.platform !== 'win32') chmodSync(file, 0o755)

    process.env.JDC_CODEGRAPH_DEV_ROOT = tmp
    const { resolveCodegraphBinary } = await import('../binary.js')
    expect(resolveCodegraphBinary()).toBe(file)
  })

  it('finds binary under resources/codegraph (Electron main process cwd)', async () => {
    const hostKey = `${process.platform === 'win32' ? 'win32' : process.platform}-${process.arch}`
    const dir = path.join(tmp, 'resources', 'codegraph', hostKey, 'bin')
    mkdirSync(dir, { recursive: true })
    const binName = process.platform === 'win32' ? 'codegraph.exe' : 'codegraph'
    const file = path.join(dir, binName)
    writeFileSync(file, '#!/bin/sh\necho 0\n')
    if (process.platform !== 'win32') chmodSync(file, 0o755)

    process.env.JDC_CODEGRAPH_DEV_ROOT = tmp
    const { resolveCodegraphBinary } = await import('../binary.js')
    expect(resolveCodegraphBinary()).toBe(file)
  })

  it('returns null when binary cannot be located', async () => {
    process.env.JDC_CODEGRAPH_DEV_ROOT = tmp
    process.env.PATH = ''
    const { resolveCodegraphBinary } = await import('../binary.js')
    expect(resolveCodegraphBinary()).toBeNull()
  })

  it('isCodegraphAvailable mirrors resolveCodegraphBinary', async () => {
    process.env.JDC_CODEGRAPH_DEV_ROOT = tmp
    process.env.PATH = ''
    const { isCodegraphAvailable } = await import('../binary.js')
    expect(isCodegraphAvailable()).toBe(false)
  })
})
