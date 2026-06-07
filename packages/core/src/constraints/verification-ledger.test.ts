import { describe, expect, it } from 'vitest'
import { VerificationLedger } from './verification-ledger.js'
import { evaluateTurnEndGate } from './turn-end-gate.js'

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

  it('tracks verification requirements and marks matching commands passed', () => {
    const ledger = new VerificationLedger({ now: () => 100 })
    ledger.recordMutation({ filePath: 'src/app.ts', toolUseId: 'edit_1' })
    ledger.setRequirements([{
      id: 'verify_test',
      kind: 'test',
      command: 'pnpm test',
      status: 'pending',
      files: ['src/app.ts'],
      reason: 'test script covers changed files.',
    }])

    ledger.recordCommand({
      toolUseId: 'bash_1',
      command: 'pnpm test',
      kind: 'test',
      status: 'passed',
      output: 'ok',
    })

    expect(ledger.getRequirements()).toEqual([expect.objectContaining({
      id: 'verify_test',
      status: 'passed',
      satisfiedByToolUseId: 'bash_1',
    })])
  })

  it('keeps failed requirements visible for the turn-end gate', () => {
    const ledger = new VerificationLedger({ now: () => 100 })
    ledger.recordMutation({ filePath: 'src/app.ts', toolUseId: 'edit_1' })
    ledger.setRequirements([{
      id: 'verify_test',
      kind: 'test',
      command: 'pnpm test',
      status: 'pending',
      files: ['src/app.ts'],
      reason: 'test script covers changed files.',
    }])

    ledger.recordCommand({
      toolUseId: 'bash_1',
      command: 'pnpm test',
      kind: 'test',
      status: 'failed',
      output: '1 failed',
    })

    expect(ledger.getRequirements()).toEqual([expect.objectContaining({
      id: 'verify_test',
      status: 'failed',
      failure: '1 failed',
    })])
  })

  it('preserves passed requirements only when replacement describes the same work', () => {
    const ledger = new VerificationLedger({ now: () => 100 })
    ledger.setRequirements([{
      id: 'verify_test',
      kind: 'test',
      command: 'pnpm test',
      status: 'pending',
      files: ['src/app.ts'],
      reason: 'test script covers changed files.',
    }])
    ledger.recordCommand({
      toolUseId: 'bash_1',
      command: 'pnpm test',
      kind: 'test',
      status: 'passed',
      output: 'ok',
    })

    ledger.setRequirements([
      {
        id: 'verify_test',
        kind: 'test',
        command: 'pnpm test',
        status: 'pending',
        files: ['src/app.ts'],
        reason: 'test script covers changed files.',
      },
      {
        id: 'verify_build',
        kind: 'build',
        command: 'pnpm build',
        status: 'pending',
        files: ['src/app.ts'],
        reason: 'build script covers changed files.',
      },
    ])

    expect(ledger.getRequirements()).toEqual([
      expect.objectContaining({
        id: 'verify_test',
        status: 'passed',
        satisfiedByToolUseId: 'bash_1',
        reason: 'test script covers changed files.',
      }),
      expect.objectContaining({
        id: 'verify_build',
        status: 'pending',
      }),
    ])
  })

  it('resets a passed requirement when replacement covers different files', () => {
    let currentTime = 100
    const ledger = new VerificationLedger({ now: () => currentTime })
    ledger.recordMutation({ filePath: 'src/app.ts', toolUseId: 'edit_1' })
    ledger.setRequirements([{
      id: 'verify_test',
      kind: 'test',
      command: 'pnpm test',
      status: 'pending',
      files: ['src/app.ts'],
      reason: 'test script covers changed files.',
    }])
    currentTime = 200
    ledger.recordCommand({
      toolUseId: 'bash_1',
      command: 'pnpm test',
      kind: 'test',
      status: 'passed',
      output: 'ok',
    })

    currentTime = 300
    ledger.recordMutation({ filePath: 'src/other.ts', toolUseId: 'edit_2' })
    ledger.setRequirements([{
      id: 'verify_test',
      kind: 'test',
      command: 'pnpm test',
      status: 'pending',
      files: ['src/other.ts'],
      reason: 'test script covers changed files.',
    }])

    expect(ledger.getRequirements()).toEqual([expect.objectContaining({
      id: 'verify_test',
      status: 'pending',
      files: ['src/other.ts'],
    })])
  })

  it('resets passed requirements when the same covered file changes again', () => {
    let currentTime = 100
    const ledger = new VerificationLedger({ now: () => currentTime })
    ledger.recordMutation({ filePath: 'src/app.ts', toolUseId: 'edit_1' })
    ledger.setRequirements([
      {
        id: 'verify_test',
        kind: 'test',
        command: 'pnpm test',
        status: 'pending',
        files: ['src/app.ts'],
        reason: 'test script covers changed files.',
      },
      {
        id: 'verify_build',
        kind: 'build',
        command: 'pnpm build',
        status: 'pending',
        files: ['src/app.ts'],
        reason: 'build script covers changed files.',
      },
    ])

    currentTime = 200
    ledger.recordCommand({
      toolUseId: 'bash_1',
      command: 'pnpm test',
      kind: 'test',
      status: 'passed',
      output: 'ok',
    })
    currentTime = 300
    ledger.recordCommand({
      toolUseId: 'bash_2',
      command: 'pnpm build',
      kind: 'build',
      status: 'passed',
      output: 'ok',
    })

    currentTime = 400
    ledger.recordMutation({ filePath: 'src/app.ts', toolUseId: 'edit_2' })
    ledger.setRequirements([
      {
        id: 'verify_test',
        kind: 'test',
        command: 'pnpm test',
        status: 'pending',
        files: ['src/app.ts'],
        reason: 'test script covers changed files.',
      },
      {
        id: 'verify_build',
        kind: 'build',
        command: 'pnpm build',
        status: 'pending',
        files: ['src/app.ts'],
        reason: 'build script covers changed files.',
      },
    ])

    currentTime = 500
    ledger.recordCommand({
      toolUseId: 'bash_3',
      command: 'pnpm test',
      kind: 'test',
      status: 'passed',
      output: 'ok',
    })

    expect(ledger.getChangedFiles()[0]).toMatchObject({ status: 'verified', verifiedByToolUseId: 'bash_3' })
    expect(ledger.getRequirements()).toEqual([
      expect.objectContaining({ id: 'verify_test', status: 'passed', satisfiedByToolUseId: 'bash_3' }),
      expect.objectContaining({ id: 'verify_build', status: 'pending' }),
    ])
  })

  it('removes requirements omitted from the replacement set', () => {
    const ledger = new VerificationLedger({ now: () => 100 })
    ledger.setRequirements([
      {
        id: 'verify_test',
        kind: 'test',
        command: 'pnpm test',
        status: 'pending',
        files: ['src/app.ts'],
        reason: 'test script covers changed files.',
      },
      {
        id: 'verify_build',
        kind: 'build',
        command: 'pnpm build',
        status: 'unavailable',
        files: ['src/app.ts'],
        reason: 'No build script found in package.json.',
      },
    ])

    ledger.setRequirements([{
      id: 'verify_diff_check',
      kind: 'diff_check',
      command: 'git diff --check',
      status: 'pending',
      files: ['docs/phase5.md'],
      reason: 'Documentation-only changes require whitespace/conflict-marker verification.',
    }])

    expect(ledger.getRequirements()).toEqual([expect.objectContaining({ id: 'verify_diff_check' })])
  })

  it('applies existing command history to requirements derived after commands run', () => {
    let currentTime = 100
    const ledger = new VerificationLedger({ now: () => currentTime })
    ledger.recordMutation({ filePath: 'src/app.ts', toolUseId: 'edit_1' })
    currentTime = 200
    ledger.recordCommand({
      toolUseId: 'bash_1',
      command: 'pnpm test',
      kind: 'test',
      status: 'failed',
      output: '1 failed',
    })

    ledger.setRequirements([{
      id: 'verify_test',
      kind: 'test',
      command: 'pnpm test',
      status: 'pending',
      files: ['src/app.ts'],
      reason: 'test script covers changed files.',
    }])

    expect(ledger.getRequirements()).toEqual([expect.objectContaining({
      id: 'verify_test',
      status: 'failed',
      satisfiedByToolUseId: 'bash_1',
      failure: '1 failed',
    })])
  })

  it('does not match focused verification commands for a different package scope', () => {
    let currentTime = 100
    const ledger = new VerificationLedger({ now: () => currentTime })
    ledger.recordMutation({ filePath: 'packages/core/src/session.ts', toolUseId: 'edit_1' })
    ledger.setRequirements([{
      id: 'verify_build',
      kind: 'build',
      command: 'pnpm build',
      status: 'pending',
      files: ['packages/core/src/session.ts'],
      reason: 'build script covers changed files.',
    }])

    currentTime = 200
    ledger.recordCommand({
      toolUseId: 'bash_1',
      command: 'pnpm --filter @jdcagnet/ui build',
      kind: 'build',
      status: 'passed',
      output: 'ok',
    })

    expect(ledger.getChangedFiles()[0]).toMatchObject({ status: 'verified', verifiedByToolUseId: 'bash_1' })
    expect(ledger.getRequirements()).toEqual([expect.objectContaining({
      id: 'verify_build',
      status: 'pending',
    })])
    expect(evaluateTurnEndGate({
      changedFiles: ledger.getChangedFiles(),
      requirements: ledger.getRequirements(),
      assistantText: 'Done.',
    })).toEqual(expect.objectContaining({
      action: 'append_disclosure',
      severity: 'warning',
    }))
  })

  it('does not match cwd-scoped verification commands for a different package scope', () => {
    let currentTime = 100
    const ledger = new VerificationLedger({ now: () => currentTime })
    ledger.recordMutation({ filePath: 'packages/ui/src/App.tsx', toolUseId: 'edit_1' })
    ledger.setRequirements([{
      id: 'verify_build',
      kind: 'build',
      command: 'pnpm build',
      status: 'pending',
      files: ['packages/ui/src/App.tsx'],
      reason: 'build script covers changed files.',
    }])

    currentTime = 200
    ledger.recordCommand({
      toolUseId: 'bash_1',
      command: 'cd packages/core && pnpm build',
      kind: 'build',
      status: 'passed',
      output: 'ok',
    })

    expect(ledger.getRequirements()).toEqual([expect.objectContaining({
      id: 'verify_build',
      status: 'pending',
    })])
    expect(evaluateTurnEndGate({
      changedFiles: ledger.getChangedFiles(),
      requirements: ledger.getRequirements(),
      assistantText: 'Done.',
    })).toEqual(expect.objectContaining({
      action: 'append_disclosure',
      severity: 'warning',
    }))
  })

  it('matches cwd-scoped verification commands for the changed package scope', () => {
    let currentTime = 100
    const ledger = new VerificationLedger({ now: () => currentTime })
    ledger.recordMutation({ filePath: 'packages/ui/src/App.tsx', toolUseId: 'edit_1' })
    ledger.setRequirements([{
      id: 'verify_build',
      kind: 'build',
      command: 'pnpm build',
      status: 'pending',
      files: ['packages/ui/src/App.tsx'],
      reason: 'build script covers changed files.',
    }])

    currentTime = 200
    ledger.recordCommand({
      toolUseId: 'bash_1',
      command: 'cd packages/ui && pnpm build',
      kind: 'build',
      status: 'passed',
      output: 'ok',
    })

    expect(ledger.getRequirements()).toEqual([expect.objectContaining({
      id: 'verify_build',
      status: 'passed',
      satisfiedByToolUseId: 'bash_1',
    })])
  })

  it('matches focused package verification commands for the changed package scope', () => {
    let currentTime = 100
    const ledger = new VerificationLedger({ now: () => currentTime })
    ledger.recordMutation({ filePath: 'packages/core/src/session.ts', toolUseId: 'edit_1' })
    ledger.setRequirements([{
      id: 'verify_build',
      kind: 'build',
      command: 'pnpm build',
      status: 'pending',
      files: ['packages/core/src/session.ts'],
      reason: 'build script covers changed files.',
    }])

    currentTime = 200
    ledger.recordCommand({
      toolUseId: 'bash_1',
      command: 'pnpm --filter @jdcagnet/core build',
      kind: 'build',
      status: 'passed',
      output: 'ok',
    })

    expect(ledger.getRequirements()).toEqual([expect.objectContaining({
      id: 'verify_build',
      status: 'passed',
      satisfiedByToolUseId: 'bash_1',
    })])
  })

  it('matches focused package verification commands to root script requirements by kind and script intent', () => {
    let currentTime = 100
    const ledger = new VerificationLedger({ now: () => currentTime })
    ledger.recordMutation({ filePath: 'packages/core/src/session.ts', toolUseId: 'edit_1' })
    ledger.setRequirements([{
      id: 'verify_build',
      kind: 'build',
      command: 'pnpm build',
      status: 'pending',
      files: ['packages/core/src/session.ts'],
      reason: 'build script covers changed files.',
    }])

    currentTime = 200
    ledger.recordCommand({
      toolUseId: 'bash_1',
      command: 'pnpm --filter @jdcagnet/core build',
      kind: 'build',
      status: 'passed',
      output: 'ok',
    })

    expect(ledger.getRequirements()).toEqual([expect.objectContaining({
      id: 'verify_build',
      status: 'passed',
      satisfiedByToolUseId: 'bash_1',
    })])
  })

  it('reads pending and unavailable requirements separately', () => {
    const ledger = new VerificationLedger({ now: () => 100 })
    ledger.setRequirements([
      {
        id: 'verify_test',
        kind: 'test',
        command: 'pnpm test',
        status: 'pending',
        files: ['src/app.ts'],
        reason: 'test script covers changed files.',
      },
      {
        id: 'verify_build',
        kind: 'build',
        command: 'pnpm build',
        status: 'unavailable',
        files: ['src/app.ts'],
        reason: 'No build script found in package.json.',
      },
    ])

    expect(ledger.getPendingRequirements()).toEqual([expect.objectContaining({ id: 'verify_test' })])
    expect(ledger.getUnavailableRequirements()).toEqual([expect.objectContaining({ id: 'verify_build' })])
  })
})
