import { describe, it, expect } from 'vitest'
import { TeamConcurrencyController } from '../team-concurrency.js'
import { DEFAULT_CONCURRENCY_POLICY } from '../team-types.js'

describe('TeamConcurrencyController', () => {
  it('allows read-only agents up to limit', () => {
    const ctrl = new TeamConcurrencyController(DEFAULT_CONCURRENCY_POLICY)
    for (let i = 0; i < 8; i++) {
      expect(ctrl.canStart('explore')).toBe(true)
      ctrl.markRunning(`member-${i}`, 'explore')
    }
    expect(ctrl.canStart('explore')).toBe(false)
  })

  it('limits write-capable agents to maxWriteWorkers (5 by default)', () => {
    const ctrl = new TeamConcurrencyController(DEFAULT_CONCURRENCY_POLICY)
    ctrl.markRunning('writer-1', 'general')
    ctrl.markRunning('writer-2', 'general')
    ctrl.markRunning('writer-3', 'general')
    ctrl.markRunning('writer-4', 'general')
    expect(ctrl.canStart('general')).toBe(true)
    ctrl.markRunning('writer-5', 'general')
    expect(ctrl.canStart('general')).toBe(false)
    expect(ctrl.canStart('refactor')).toBe(false)
    expect(ctrl.canStart('frontend-designer')).toBe(false)
  })

  it('releasing a slot allows new starts', () => {
    const ctrl = new TeamConcurrencyController(DEFAULT_CONCURRENCY_POLICY)
    ctrl.markRunning('writer-1', 'general')
    ctrl.markRunning('writer-2', 'general')
    ctrl.markRunning('writer-3', 'general')
    ctrl.markRunning('writer-4', 'general')
    ctrl.markRunning('writer-5', 'general')
    expect(ctrl.canStart('general')).toBe(false)
    ctrl.markDone('writer-1')
    expect(ctrl.canStart('general')).toBe(true)
  })

  it('respects total active worker limit', () => {
    const ctrl = new TeamConcurrencyController({ ...DEFAULT_CONCURRENCY_POLICY, maxActiveWorkers: 3 })
    ctrl.markRunning('a', 'explore')
    ctrl.markRunning('b', 'explore')
    ctrl.markRunning('c', 'explore')
    expect(ctrl.canStart('explore')).toBe(false)
  })

  it('limits shell-capable agents', () => {
    const ctrl = new TeamConcurrencyController({ ...DEFAULT_CONCURRENCY_POLICY, maxShellWorkers: 2 })
    ctrl.markRunning('a', 'security-auditor')
    expect(ctrl.canStart('security-auditor')).toBe(true)
    ctrl.markRunning('b', 'security-auditor')
    expect(ctrl.canStart('security-auditor')).toBe(false)
  })

  it('tracks active count', () => {
    const ctrl = new TeamConcurrencyController(DEFAULT_CONCURRENCY_POLICY)
    expect(ctrl.getActiveCount()).toBe(0)
    ctrl.markRunning('a', 'explore')
    ctrl.markRunning('b', 'plan')
    expect(ctrl.getActiveCount()).toBe(2)
    ctrl.markDone('a')
    expect(ctrl.getActiveCount()).toBe(1)
  })
})
