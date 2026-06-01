import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { saveSnapshot } from '../indexer/snapshot.js'
import type { StoreSnapshot } from '../graph/store.js'

const EMPTY_STORE: StoreSnapshot = { files: [], lastIndexed: 0 }

function tmpRepo(withGit = true): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jdc-snap-ignore-'))
  if (withGit) mkdirSync(path.join(dir, '.git'), { recursive: true })
  return dir
}

describe('context-engine: snapshot gitignore protection', () => {
  it('appends .jdcagnet/ to an existing .gitignore in a git repo', async () => {
    const dir = tmpRepo()
    try {
      writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n')
      await saveSnapshot(dir, EMPTY_STORE)
      const gi = readFileSync(path.join(dir, '.gitignore'), 'utf-8')
      expect(gi).toContain('.jdcagnet/')
      expect(gi).toContain('node_modules/')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('creates .gitignore when missing in a git repo', async () => {
    const dir = tmpRepo()
    try {
      await saveSnapshot(dir, EMPTY_STORE)
      const giPath = path.join(dir, '.gitignore')
      expect(existsSync(giPath)).toBe(true)
      expect(readFileSync(giPath, 'utf-8')).toContain('.jdcagnet/')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not duplicate when .jdcagnet/ is already ignored', async () => {
    const dir = tmpRepo()
    try {
      writeFileSync(path.join(dir, '.gitignore'), '.jdcagnet/\n')
      await saveSnapshot(dir, EMPTY_STORE)
      const gi = readFileSync(path.join(dir, '.gitignore'), 'utf-8')
      expect(gi.match(/\.jdcagnet/g)?.length).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not touch .gitignore outside a git repo', async () => {
    const dir = tmpRepo(false)
    try {
      await saveSnapshot(dir, EMPTY_STORE)
      expect(existsSync(path.join(dir, '.gitignore'))).toBe(false)
      // snapshot itself is still written
      expect(existsSync(path.join(dir, '.jdcagnet/context-engine/index.json'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
