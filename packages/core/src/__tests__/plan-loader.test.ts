import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadActivePlan } from '../context.js'
import { mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('loadActivePlan', () => {
  const tmpDir = path.join(os.tmpdir(), 'plan-loader-test-' + Date.now())
  const planDir = path.join(tmpDir, '.jdcagnet', 'plans')

  const setMtime = (file: string, ageMs: number) => {
    const t = (Date.now() - ageMs) / 1000
    utimesSync(file, t, t)
  }

  beforeEach(() => { mkdirSync(planDir, { recursive: true }) })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('returns null when no plans exist', async () => {
    const result = await loadActivePlan(tmpDir)
    expect(result).toBeNull()
  })

  it('returns the most recently modified plan within the 24h window', async () => {
    const old = path.join(planDir, 'aaa-old.md')
    const recent = path.join(planDir, 'bbb-recent.md')
    writeFileSync(old, 'old plan')
    writeFileSync(recent, 'recent plan')
    setMtime(old, 12 * 60 * 60 * 1000)   // 12h ago
    setMtime(recent, 60 * 1000)           // 1min ago
    const result = await loadActivePlan(tmpDir)
    expect(result).not.toBeNull()
    expect(result!.content).toBe('recent plan')
    expect(result!.fileName).toBe('bbb-recent.md')
  })

  it('skips completed plans', async () => {
    const done = path.join(planDir, 'a-done.md')
    const active = path.join(planDir, 'b-active.md')
    writeFileSync(done, '<!-- COMPLETED -->\nold plan')
    writeFileSync(active, 'active plan')
    setMtime(done, 60 * 1000)
    setMtime(active, 5 * 60 * 1000)
    const result = await loadActivePlan(tmpDir)
    expect(result!.content).toBe('active plan')
  })

  it('returns null when all plans are completed', async () => {
    writeFileSync(path.join(planDir, '001-done.md'), '<!-- COMPLETED -->\ndone')
    const result = await loadActivePlan(tmpDir)
    expect(result).toBeNull()
  })

  it('returns null when the most recent plan is older than 24h (stale)', async () => {
    const stale = path.join(planDir, 'old.md')
    writeFileSync(stale, 'forgotten plan')
    setMtime(stale, 48 * 60 * 60 * 1000) // 48h ago
    const result = await loadActivePlan(tmpDir)
    expect(result).toBeNull()
  })
})
