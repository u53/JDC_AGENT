import { describe, it, expect } from 'vitest'
import { DEFAULT_CONCURRENCY_POLICY } from '../team-types.js'

describe('team-types', () => {
  it('DEFAULT_CONCURRENCY_POLICY has correct defaults', () => {
    expect(DEFAULT_CONCURRENCY_POLICY.maxWorkersPerTeam).toBe(10)
    expect(DEFAULT_CONCURRENCY_POLICY.maxActiveWorkers).toBe(8)
    expect(DEFAULT_CONCURRENCY_POLICY.maxReadOnlyWorkers).toBe(8)
    expect(DEFAULT_CONCURRENCY_POLICY.maxWriteWorkers).toBe(5)
    expect(DEFAULT_CONCURRENCY_POLICY.maxShellWorkers).toBe(2)
  })

  it('maxActiveWorkers does not exceed maxWorkersPerTeam', () => {
    expect(DEFAULT_CONCURRENCY_POLICY.maxActiveWorkers).toBeLessThanOrEqual(
      DEFAULT_CONCURRENCY_POLICY.maxWorkersPerTeam
    )
  })
})
