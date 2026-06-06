import { describe, expect, it } from 'vitest'
import { VerificationLedger } from './verification-ledger.js'

describe('VerificationLedger', () => {
  it('marks changed files pending until a verification command passes', () => {
    const ledger = new VerificationLedger({ now: () => 100 })
    ledger.recordMutation({ filePath: '/repo/src/a.ts', toolUseId: 'edit_1' })

    expect(ledger.getChangedFiles()).toEqual([
      expect.objectContaining({
        filePath: '/repo/src/a.ts',
        status: 'pending',
        changedByToolUseId: 'edit_1',
      }),
    ])

    ledger.recordCommand({
      toolUseId: 'bash_1',
      command: 'pnpm --filter @jdcagnet/core build',
      kind: 'build',
      status: 'passed',
      output: 'ok',
    })

    expect(ledger.getChangedFiles()[0]).toMatchObject({
      status: 'verified',
      verifiedByToolUseId: 'bash_1',
    })
  })

  it('keeps changed files failed when verification command fails', () => {
    const ledger = new VerificationLedger({ now: () => 100 })
    ledger.recordMutation({ filePath: '/repo/src/a.ts', toolUseId: 'edit_1' })

    ledger.recordCommand({
      toolUseId: 'bash_1',
      command: 'pnpm test',
      kind: 'test',
      status: 'failed',
      output: '1 failed',
    })

    expect(ledger.getChangedFiles()[0]).toMatchObject({
      status: 'failed',
      verificationFailure: '1 failed',
    })
  })

  it('marks changed files failed when a later verification command fails after a pass', () => {
    const ledger = new VerificationLedger({ now: () => 100 })
    ledger.recordMutation({ filePath: '/repo/src/a.ts', toolUseId: 'edit_1' })

    ledger.recordCommand({
      toolUseId: 'bash_1',
      command: 'pnpm --filter @jdcagnet/core build',
      kind: 'build',
      status: 'passed',
      output: 'build ok',
    })
    ledger.recordCommand({
      toolUseId: 'bash_2',
      command: 'pnpm test',
      kind: 'test',
      status: 'failed',
      output: '1 failed',
    })

    expect(ledger.getChangedFiles()[0]).toMatchObject({
      status: 'failed',
      verifiedByToolUseId: 'bash_1',
      verificationFailure: '1 failed',
    })
  })

  it('does not mark later mutations verified by earlier commands', () => {
    const ledger = new VerificationLedger({ now: () => 100 })
    ledger.recordCommand({
      toolUseId: 'bash_1',
      command: 'pnpm test',
      kind: 'test',
      status: 'passed',
      output: 'ok',
    })
    ledger.recordMutation({ filePath: '/repo/src/a.ts', toolUseId: 'edit_1' })

    expect(ledger.getChangedFiles()[0].status).toBe('pending')
  })
})
