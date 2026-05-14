import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadActivePlan } from '../context.js'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('loadActivePlan', () => {
  const tmpDir = path.join(os.tmpdir(), 'plan-loader-test-' + Date.now())
  const planDir = path.join(tmpDir, '.jdcagnet', 'plans')

  beforeEach(() => { mkdirSync(planDir, { recursive: true }) })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('returns null when no plans exist', async () => {
    const result = await loadActivePlan(tmpDir)
    expect(result).toBeNull()
  })

  it('returns the most recent plan', async () => {
    writeFileSync(path.join(planDir, '001-old.md'), 'old plan')
    writeFileSync(path.join(planDir, '002-new.md'), 'new plan')
    const result = await loadActivePlan(tmpDir)
    expect(result).not.toBeNull()
    expect(result!.content).toBe('new plan')
    expect(result!.fileName).toBe('002-new.md')
  })

  it('skips completed plans', async () => {
    writeFileSync(path.join(planDir, '001-done.md'), '<!-- COMPLETED -->\nold plan')
    writeFileSync(path.join(planDir, '002-active.md'), 'active plan')
    const result = await loadActivePlan(tmpDir)
    expect(result!.content).toBe('active plan')
  })

  it('returns null when all plans are completed', async () => {
    writeFileSync(path.join(planDir, '001-done.md'), '<!-- COMPLETED -->\ndone')
    const result = await loadActivePlan(tmpDir)
    expect(result).toBeNull()
  })
})
