import { describe, expect, it } from 'vitest'
import { PolicyEventLedger } from './policy-events.js'

describe('PolicyEventLedger', () => {
  it('records bounded product policy events in insertion order', () => {
    const ledger = new PolicyEventLedger({ maxEvents: 2, now: () => 123 })

    ledger.record({
      phase: 'pre_tool_use',
      source: 'FileMutationPolicy',
      decision: 'allow',
      toolName: 'Read',
      toolUseId: 'read_1',
      cwd: '/repo',
    })
    ledger.record({
      phase: 'pre_tool_use',
      source: 'FileMutationPolicy',
      decision: 'block',
      reason: 'must read file first',
      toolName: 'Edit',
      toolUseId: 'edit_1',
      cwd: '/repo',
    })
    ledger.record({
      phase: 'post_tool_use',
      source: 'VerificationLedger',
      decision: 'record',
      toolName: 'Bash',
      toolUseId: 'bash_1',
      cwd: '/repo',
    })

    expect(ledger.list().map(event => event.toolUseId)).toEqual(['edit_1', 'bash_1'])
    expect(ledger.list()[0]).toMatchObject({
      id: 'policy_123_2',
      phase: 'pre_tool_use',
      decision: 'block',
      reason: 'must read file first',
    })
  })
})
