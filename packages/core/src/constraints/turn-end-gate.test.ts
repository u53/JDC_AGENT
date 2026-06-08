import { describe, expect, it } from 'vitest'
import { evaluateTurnEndGate } from './turn-end-gate.js'
import type { ChangedFileRecord, VerificationRequirementRecord } from './verification-ledger.js'

const changedFile: ChangedFileRecord = {
  filePath: 'src/app.ts',
  changedByToolUseId: 'edit_1',
  changedAt: 100,
  status: 'pending',
  updatedAt: 100,
}

function requirement(input: Partial<VerificationRequirementRecord> = {}): VerificationRequirementRecord {
  return {
    id: 'verify_test',
    kind: 'test',
    command: 'pnpm test',
    status: 'pending',
    files: ['src/app.ts'],
    reason: 'test script covers changed files.',
    coveredChangedAt: 100,
    ...input,
  }
}

describe('evaluateTurnEndGate', () => {
  it('allows final response when no files changed', () => {
    expect(evaluateTurnEndGate({ changedFiles: [], requirements: [], assistantText: 'Done.' })).toEqual({ action: 'allow' })
  })

  it('appends disclosure for pending required verification', () => {
    const decision = evaluateTurnEndGate({
      changedFiles: [changedFile],
      requirements: [requirement()],
      assistantText: '修好了。',
    })

    expect(decision).toEqual(expect.objectContaining({
      action: 'append_disclosure',
      severity: 'warning',
    }))
    if (decision.action === 'append_disclosure') {
      expect(decision.disclosure).toContain('Verification not completed')
      expect(decision.disclosure).toContain('pnpm test')
    }
  })

  it('appends failure disclosure for failed verification', () => {
    const decision = evaluateTurnEndGate({
      changedFiles: [{ ...changedFile, status: 'failed', verificationFailure: '1 failed' }],
      requirements: [requirement({ status: 'failed', failure: '1 failed' })],
      assistantText: '完成。',
    })

    expect(decision).toEqual(expect.objectContaining({
      action: 'append_disclosure',
      severity: 'error',
    }))
    if (decision.action === 'append_disclosure') {
      expect(decision.disclosure).toContain('Verification failed')
      expect(decision.disclosure).toContain('1 failed')
    }
  })

  it('allows final response for unavailable or skipped verification requirements', () => {
    const decision = evaluateTurnEndGate({
      changedFiles: [changedFile],
      requirements: [requirement({ status: 'unavailable', reason: 'No test script found in package.json.' })],
      assistantText: '完成。',
    })

    expect(decision).toEqual({ action: 'allow' })
    expect(JSON.stringify(decision)).not.toContain('Verification unavailable or skipped')
  })

  it('allows final response for unresolved changed files when no verification requirements were derived', () => {
    const decision = evaluateTurnEndGate({
      changedFiles: [changedFile],
      requirements: [],
      assistantText: '完成。',
    })

    expect(decision).toEqual({ action: 'allow' })
  })

  it('appends warning when changed files remain unresolved even if requirements passed', () => {
    const decision = evaluateTurnEndGate({
      changedFiles: [changedFile],
      requirements: [requirement({ status: 'passed', satisfiedByToolUseId: 'bash_1' })],
      assistantText: '完成。',
    })

    expect(decision).toEqual(expect.objectContaining({
      action: 'append_disclosure',
      severity: 'warning',
    }))
    if (decision.action === 'append_disclosure') {
      expect(decision.disclosure).toContain('Verification not completed')
      expect(decision.disclosure).toContain('src/app.ts')
    }
  })

  it('appends error when changed files remain failed even if requirements passed', () => {
    const decision = evaluateTurnEndGate({
      changedFiles: [{ ...changedFile, status: 'failed', verificationFailure: 'build failed' }],
      requirements: [requirement({ status: 'passed', satisfiedByToolUseId: 'bash_1' })],
      assistantText: '完成。',
    })

    expect(decision).toEqual(expect.objectContaining({
      action: 'append_disclosure',
      severity: 'error',
    }))
    if (decision.action === 'append_disclosure') {
      expect(decision.disclosure).toContain('Verification failed')
      expect(decision.disclosure).toContain('build failed')
    }
  })

  it('allows final response when all requirements passed', () => {
    expect(evaluateTurnEndGate({
      changedFiles: [{ ...changedFile, status: 'verified' }],
      requirements: [requirement({ status: 'passed', satisfiedByToolUseId: 'bash_1' })],
      assistantText: '完成，测试已通过。',
    })).toEqual({ action: 'allow' })
  })
})
