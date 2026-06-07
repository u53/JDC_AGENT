import { describe, expect, it } from 'vitest'
import { ConstraintPolicyRuntime } from './policy-runtime.js'
import { buildConstraintObservabilitySnapshot } from './observability.js'
import { FileReadStateCache } from '../file-read-state.js'

describe('buildConstraintObservabilitySnapshot', () => {
  it('reports blocked write attempts as the primary status', () => {
    const runtime = new ConstraintPolicyRuntime({ now: () => 1_700_000_000_000 })
    const fileReadState = new FileReadStateCache()

    runtime.preToolUse({
      toolName: 'Edit',
      toolUseId: 'edit_1',
      input: { file_path: 'src/app.ts', old_string: 'old', new_string: 'new' },
      cwd: '/repo',
      fileReadState,
    })

    const snapshot = buildConstraintObservabilitySnapshot({
      runtime,
      cwd: '/repo',
      inspectedAt: 1_700_000_000_500,
    })

    expect(snapshot.status).toBe('blocked')
    expect(snapshot.blockedActions).toEqual([
      expect.objectContaining({
        toolName: 'Edit',
        toolUseId: 'edit_1',
        reason: expect.stringMatching(/read/i),
      }),
    ])
    expect(snapshot.summary.primary).toBe('有操作被约束拦截')
  })

  it('reports pending verification after mutations', () => {
    const runtime = new ConstraintPolicyRuntime({ now: () => 100 })
    runtime.verificationLedger.recordMutation({ filePath: 'packages/core/src/session.ts', toolUseId: 'edit_1' })

    const snapshot = buildConstraintObservabilitySnapshot({
      runtime,
      cwd: '/repo',
      inspectedAt: 150,
    })

    expect(snapshot.status).toBe('needs_verification')
    expect(snapshot.verification.status).toBe('pending')
    expect(snapshot.verification.changedFiles).toEqual([
      expect.objectContaining({ filePath: 'packages/core/src/session.ts', status: 'pending' }),
    ])
  })

  it('reports verified files when a covering command passed', () => {
    const runtime = new ConstraintPolicyRuntime({ now: () => 100 })
    runtime.verificationLedger.recordMutation({ filePath: 'packages/core/src/session.ts', toolUseId: 'edit_1' })
    runtime.verificationLedger.recordCommand({
      toolUseId: 'bash_1',
      command: 'pnpm --filter @jdcagnet/core test',
      kind: 'test',
      status: 'passed',
      output: 'ok',
    })

    const snapshot = buildConstraintObservabilitySnapshot({
      runtime,
      cwd: '/repo',
      inspectedAt: 200,
    })

    expect(snapshot.status).toBe('verified')
    expect(snapshot.verification.status).toBe('passed')
    expect(snapshot.verification.changedFiles[0]).toMatchObject({ status: 'verified', verifiedByToolUseId: 'bash_1' })
  })

  it('derives missing evidence from the latest agent contract section', () => {
    const runtime = new ConstraintPolicyRuntime({ now: () => 100 })
    const snapshot = buildConstraintObservabilitySnapshot({
      runtime,
      cwd: '/repo',
      inspectedAt: 200,
      context: {
        status: 'available',
        inspectedAt: 200,
        bundle: {
          id: 'ctx_1',
          sessionId: 'session_1',
          requestHash: 'hash',
          createdAt: 150,
          sections: [{
            id: 'agent_contract_1',
            kind: 'agent_contract',
            title: 'Agent run contract',
            content: [
              'Agent run contract',
              'Intent: code_edit',
              'Objective: Fix login bug',
              'Model profile: strict_tool_grounding',
              'Evidence strictness: strict',
              'Missing evidence:',
              '- relevant_code: Code edit turns need target file or symbol evidence before mutation.',
              'Policy: Existing files must be read with fresh content before mutation.',
            ].join('\n'),
            citations: [],
            priority: 100,
            confidence: 1,
            freshness: 'live',
            sourceProvider: 'JdcAgentConstraintEngine',
            tokenEstimate: 80,
            tokenCost: { tokenEstimate: 80 },
          }],
          citations: [],
          diagnostics: [],
          budget: { usedTokens: 80, droppedTokens: 0 },
        },
        acceptedProjectFacts: [],
        droppedSections: [],
        providerHealth: [],
        providerTimings: [],
        harvestQueue: { jobs: [], summary: { queued: 0, classified: 0, distilling: 0, validating: 0, accepted: 0, pending_review: 0, rejected: 0, skipped: 0, failed: 0 } },
        memoryReview: { rejected: [] },
        diagnostics: [],
      },
    })

    expect(snapshot.intent).toBe('code_edit')
    expect(snapshot.objective).toBe('Fix login bug')
    expect(snapshot.evidence.status).toBe('missing')
    expect(snapshot.evidence.missing[0]).toMatchObject({ kind: 'relevant_code' })
    expect(snapshot.modelProfile).toMatchObject({ id: 'strict_tool_grounding', evidenceStrictness: 'strict' })
  })
})
