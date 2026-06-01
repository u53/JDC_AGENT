import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ContextEngine } from '../engine.js'
import { loadSnapshot } from '../indexer/snapshot.js'

function setup(): string {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'ctxeng-snap-'))
  mkdirSync(path.join(tmp, 'src'), { recursive: true })
  writeFileSync(path.join(tmp, 'src', 'a.ts'), 'export function alpha() { return 1 }\n')
  writeFileSync(path.join(tmp, 'src', 'b.ts'), 'export function beta() { return 2 }\n')
  return tmp
}

describe('context-engine: snapshot persistence', () => {
  it('writes a snapshot to .jdcagnet/context-engine/index.json after indexing', async () => {
    const tmp = setup()
    const engine = new ContextEngine(tmp)
    await engine.index()
    // Force a synchronous flush via the watcher-stop path.
    engine.stopWatching()
    // The debounced save fires after 2s; trigger an incremental change to flush.
    await engine.reindexFile(path.join(tmp, 'src', 'a.ts'))
    // Give the debounce timer room, then assert by loading directly.
    await new Promise((r) => setTimeout(r, 2200))
    const snap = await loadSnapshot(tmp)
    expect(snap).not.toBeNull()
    expect(snap!.files.length).toBe(2)
    expect(existsSync(path.join(tmp, '.jdcagnet', 'context-engine', 'index.json'))).toBe(true)
  })

  it('loads from snapshot on a fresh engine and revalidates changed files', async () => {
    const tmp = setup()
    const first = new ContextEngine(tmp)
    await first.index()
    await first.reindexFile(path.join(tmp, 'src', 'a.ts'))
    await new Promise((r) => setTimeout(r, 2200)) // let save flush

    // New engine instance — should load the snapshot rather than rebuild blind.
    const second = new ContextEngine(tmp)
    await second.index()
    expect(second.wasLoadedFromSnapshot()).toBe(true)
    expect(second.symbolsByName('alpha').length).toBe(1)
    expect(second.symbolsByName('beta').length).toBe(1)
  })

  it('revalidation picks up a file changed while the engine was down', async () => {
    const tmp = setup()
    const first = new ContextEngine(tmp)
    await first.index()
    await first.reindexFile(path.join(tmp, 'src', 'a.ts'))
    await new Promise((r) => setTimeout(r, 2200))

    // Simulate an external edit while "offline": replace beta with gamma.
    writeFileSync(path.join(tmp, 'src', 'b.ts'), 'export function gamma() { return 3 }\n')

    const second = new ContextEngine(tmp)
    await second.index()
    expect(second.wasLoadedFromSnapshot()).toBe(true)
    expect(second.symbolsByName('gamma').length).toBe(1)
    expect(second.symbolsByName('beta').length).toBe(0)
  })

  it('drops a file deleted while the engine was down', async () => {
    const tmp = setup()
    const first = new ContextEngine(tmp)
    await first.index()
    await first.reindexFile(path.join(tmp, 'src', 'a.ts'))
    await new Promise((r) => setTimeout(r, 2200))

    rmSync(path.join(tmp, 'src', 'b.ts'))

    const second = new ContextEngine(tmp)
    await second.index()
    expect(second.symbolsByName('beta').length).toBe(0)
    expect(second.symbolsByName('alpha').length).toBe(1)
  })
})
