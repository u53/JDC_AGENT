import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FileReadStateCache } from './file-read-state.js'

describe('FileReadStateCache fresh read checks', () => {
  const tmpDir = path.join(os.tmpdir(), 'jdc-file-read-state-test')
  const filePath = path.join(tmpDir, 'sample.ts')

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true })
    await writeFile(filePath, 'const alpha = 1\nconst beta = 2\n')
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('reports not_read when a file has not been read', () => {
    const cache = new FileReadStateCache()

    const result = cache.checkFreshRead(filePath, { requiredText: 'const alpha = 1' })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('not_read')
    expect(result.message).toContain('has not been read')
  })

  it('accepts a fresh full-file read', () => {
    const cache = new FileReadStateCache()
    cache.recordRead(filePath, 0, 2000, 2, 'const alpha = 1\nconst beta = 2')

    const result = cache.checkFreshRead(filePath, { requiredText: 'const beta = 2' })

    expect(result.ok).toBe(true)
  })

  it('accepts a fresh range read only when it contains the edit anchor', () => {
    const cache = new FileReadStateCache()
    cache.recordRead(filePath, 0, 1, 2, 'const alpha = 1')

    expect(cache.checkFreshRead(filePath, { requiredText: 'const alpha = 1' }).ok).toBe(true)
    expect(cache.checkFreshRead(filePath, { requiredText: 'const beta = 2' })).toMatchObject({
      ok: false,
      reason: 'range_not_read',
    })
  })

  it('reports stale when the file changed after it was read', async () => {
    const cache = new FileReadStateCache()
    cache.recordRead(filePath, 0, 2000, 2, 'const alpha = 1\nconst beta = 2')
    await new Promise((resolve) => setTimeout(resolve, 5))
    await writeFile(filePath, 'const alpha = 10\nconst beta = 2\n')

    const result = cache.checkFreshRead(filePath, { requiredText: 'const alpha = 1' })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('stale')
  })

  it('reports stale when same-size content changes keep the same mtime', async () => {
    const cache = new FileReadStateCache()
    const originalContent = 'const alpha = 1\nconst beta = 2\n'
    cache.recordRead(filePath, 0, 2000, 3, originalContent)
    const originalStat = await stat(filePath)

    const changedContent = 'const gamma = 3\nconst beta = 2\n'
    expect(Buffer.byteLength(changedContent)).toBe(Buffer.byteLength(originalContent))
    await writeFile(filePath, changedContent)
    await utimes(filePath, originalStat.atime, originalStat.mtime)

    const result = cache.checkFreshRead(filePath)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('stale')
  })

  it('keeps read de-duplication behavior for exact unchanged ranges', () => {
    const cache = new FileReadStateCache()
    cache.recordRead(filePath, 0, 2000, 2, 'const alpha = 1\nconst beta = 2')

    expect(cache.canDedup(filePath, 0, 2000)).toBe(true)
    expect(cache.canDedup(filePath, 1, 1)).toBe(false)
  })

  it('dedupes against the newest fresh matching range after reread', async () => {
    const cache = new FileReadStateCache()
    cache.recordRead(filePath, 0, 2000, 2, 'const alpha = 1\nconst beta = 2')
    await new Promise((resolve) => setTimeout(resolve, 5))
    await writeFile(filePath, 'const alpha = 10\nconst beta = 2\n')
    cache.recordRead(filePath, 0, 2000, 2, 'const alpha = 10\nconst beta = 2')

    expect(cache.canDedup(filePath, 0, 2000)).toBe(true)
  })

  it('reports missing when a previously read file is deleted', async () => {
    const cache = new FileReadStateCache()
    cache.recordRead(filePath, 0, 2000, 2, 'const alpha = 1\nconst beta = 2')
    await unlink(filePath)

    const result = cache.checkFreshRead(filePath, { requiredText: 'const alpha = 1' })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('missing')
  })
})
