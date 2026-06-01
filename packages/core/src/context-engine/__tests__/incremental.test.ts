import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { ContextEngine } from '../engine.js'
import { hotFiles, workingChanges } from '../git/git-context.js'

describe('context-engine: incremental update', () => {
  it('reindexFile picks up new symbols and drops removed ones', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'ctxeng-inc-'))
    mkdirSync(path.join(tmp, 'src'), { recursive: true })
    const file = path.join(tmp, 'src', 'a.ts')
    writeFileSync(file, 'export function first() {}\n')
    const engine = new ContextEngine(tmp)
    await engine.index()
    expect(engine.symbolsByName('first').length).toBe(1)
    expect(engine.symbolsByName('second').length).toBe(0)

    // Modify the file: add a symbol, remove the old one.
    writeFileSync(file, 'export function second() {}\n')
    await engine.reindexFile(file)
    expect(engine.symbolsByName('first').length).toBe(0)
    expect(engine.symbolsByName('second').length).toBe(1)

    // Delete the file: reindex should drop all of its symbols.
    rmSync(file)
    await engine.reindexFile(file)
    expect(engine.symbolsByName('second').length).toBe(0)
  })

  it('skips reparse when content hash is unchanged', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'ctxeng-inc2-'))
    mkdirSync(path.join(tmp, 'src'), { recursive: true })
    const file = path.join(tmp, 'src', 'b.ts')
    writeFileSync(file, 'export function keep() {}\n')
    const engine = new ContextEngine(tmp)
    await engine.index()
    const before = engine.symbolsByName('keep')[0]
    await engine.reindexFile(file) // no change
    const after = engine.symbolsByName('keep')[0]
    expect(after.id).toBe(before.id)
  })
})

describe('context-engine: git context', () => {
  it('reads working changes and hot files in a real repo', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'ctxeng-git-'))
    const run = (args: string[]) => execFileSync('git', args, { cwd: tmp })
    run(['init', '-q'])
    run(['config', 'user.email', 'test@test.com'])
    run(['config', 'user.name', 'Test'])
    mkdirSync(path.join(tmp, 'src'), { recursive: true })
    writeFileSync(path.join(tmp, 'src', 'a.ts'), 'export const x = 1\n')
    run(['add', '.'])
    run(['commit', '-q', '-m', 'init'])
    // Make an uncommitted change.
    writeFileSync(path.join(tmp, 'src', 'a.ts'), 'export const x = 2\n')

    const changes = await workingChanges(tmp)
    expect(changes.some((c) => c.path === 'src/a.ts')).toBe(true)

    const hot = await hotFiles(tmp, 100, 10)
    expect(hot.some((h) => h.path === 'src/a.ts')).toBe(true)
  })

  it('returns empty for a non-git directory', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'ctxeng-nogit-'))
    expect(await workingChanges(tmp)).toEqual([])
    expect(await hotFiles(tmp)).toEqual([])
  })
})
