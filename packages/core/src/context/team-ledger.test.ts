import { describe, expect, it, vi } from 'vitest'
import { ContextFactSchema } from './schemas.js'
import { buildContextBundle } from './orchestrator.js'
import {
  recordTeamArtifactEvidence,
  recordTeamEventEvidence,
  recordTeamIssueEvidence,
  recordTeamTaskResultEvidence,
} from './team-ledger.js'
import type { ContextFact, ContextRequest, RawEvidence } from './types.js'
import type { TeamEvent } from '../team/team-types.js'

const request: ContextRequest = {
  sessionId: 'session_b',
  cwd: '/repo',
  userMessage: 'checkout task 做了什么，还有没有 QA issue',
  recentMessages: [],
  mode: 'chat',
  model: 'test-model',
  runtime: {},
  createdAt: 2_000,
}

describe('JDC Context Team ledger', () => {
  it('accepts explicit Team fact kinds and renders them into context bundles', async () => {
    const facts = [
      teamFact({
        id: 'team_decision_team_alpha_checkout',
        kind: 'team_decision',
        content: 'PM decision: checkout API keeps the existing response envelope.',
        citations: [{ id: 'cit_team_log', type: 'task', ref: '.team/log.md' }],
        origin: { projectKey: '/repo', actor: 'team_pm', sessionId: 'session_a', teamId: 'team_alpha' },
        tags: ['team', 'team_decision'],
        relatedTasks: ['task_checkout'],
        relatedFiles: ['.team/log.md'],
      }),
      teamFact({
        id: 'task_result_team_alpha_checkout',
        kind: 'task_result',
        content: 'Task result: checkout API validation was fixed in src/api/checkout.ts.',
        citations: [{ id: 'cit_task_result', type: 'task', ref: '.team/tasks/task_checkout/result.md' }],
        origin: { projectKey: '/repo', actor: 'team_worker', sessionId: 'session_a', teamId: 'team_alpha', memberId: 'member_api', taskId: 'task_checkout' },
        tags: ['team', 'team_result'],
        relatedTasks: ['task_checkout'],
        relatedFiles: ['.team/tasks/task_checkout/result.md', 'src/api/checkout.ts'],
      }),
      teamFact({
        id: 'artifact_summary_team_alpha_checkout_report',
        kind: 'artifact_summary',
        content: 'Artifact summary: checkout report lists validation changes and regression notes.',
        citations: [{ id: 'cit_artifact', type: 'task', ref: '.team/tasks/task_checkout/artifacts/report.md' }],
        origin: { projectKey: '/repo', actor: 'team_worker', sessionId: 'session_a', teamId: 'team_alpha', memberId: 'member_api', taskId: 'task_checkout', artifactId: 'report' },
        tags: ['team', 'team_artifact'],
        relatedTasks: ['task_checkout'],
        relatedFiles: ['.team/tasks/task_checkout/artifacts/report.md'],
      }),
      teamFact({
        id: 'qa_issue_team_alpha_issue_001',
        kind: 'qa_issue',
        content: 'Open QA issue ISSUE-001: checkout response missing validation error detail.',
        citations: [{ id: 'cit_issue', type: 'task', ref: '.team/issues/ISSUE-001.md' }],
        origin: { projectKey: '/repo', actor: 'team_worker', sessionId: 'session_a', teamId: 'team_alpha', memberId: 'member_qa', taskId: 'task_checkout', artifactId: 'ISSUE-001' },
        tags: ['team', 'team_issue'],
        relatedTasks: ['task_checkout'],
        relatedFiles: ['.team/issues/ISSUE-001.md'],
      }),
    ] as ContextFact[]

    for (const fact of facts) {
      expect(ContextFactSchema.safeParse(fact).success).toBe(true)
    }

    const result = await buildContextBundle(request, {
      injectionEnabled: true,
      store: makeStore(facts),
      providers: [],
      now: () => 3_000,
      id: () => 'ctx_team_ledger',
    })

    expect(result.renderedPrompt).toContain('PM decision: checkout API keeps the existing response envelope.')
    expect(result.renderedPrompt).toContain('Task result: checkout API validation was fixed')
    expect(result.renderedPrompt).toContain('Artifact summary: checkout report')
    expect(result.renderedPrompt).toContain('Open QA issue ISSUE-001')
  })

  it('records Team event evidence and only promotes durable manager decisions', async () => {
    const store = makeWritableStore()
    const context = ledgerContext(store)
    const events: TeamEvent[] = [
      { type: 'team_started', teamId: 'team_alpha', timestamp: 1_000 },
      { type: 'task_created', taskId: 'task_checkout', title: 'Fix checkout', timestamp: 1_001 },
      { type: 'task_assigned', taskId: 'task_checkout', memberId: 'member_api', timestamp: 1_002 },
      { type: 'task_completed', taskId: 'task_checkout', memberId: 'member_api', timestamp: 1_003 },
      { type: 'team_completed', summary: 'Checkout work completed.', timestamp: 1_004 },
      { type: 'team_failed', error: 'Team idle timeout.', timestamp: 1_005 },
    ]

    for (const event of events) {
      await recordTeamEventEvidence(event, context)
    }
    await recordTeamEventEvidence({ type: 'manager_decision', text: 'PM 思考中，等待 worker 输出。', timestamp: 1_006 }, context)
    await recordTeamEventEvidence({ type: 'manager_decision', text: 'Decision: checkout API keeps the existing response envelope.', timestamp: 1_007 }, context)

    expect(store.saveRawEvidence).toHaveBeenCalledTimes(8)
    expect(mockFirstArgs<RawEvidence>(store.saveRawEvidence).map((evidence) => evidence.metadata.eventType)).toEqual([
      'team_started',
      'task_created',
      'task_assigned',
      'task_completed',
      'team_completed',
      'team_failed',
      'manager_decision',
      'manager_decision',
    ])
    expect(store.saveFact).toHaveBeenCalledTimes(1)
    expect(mockFirstArgs<ContextFact>(store.saveFact)[0]).toMatchObject({
      kind: 'team_decision',
      scope: 'project',
      content: 'Decision: checkout API keeps the existing response envelope.',
      origin: {
        projectKey: '/repo',
        actor: 'team_pm',
        sessionId: 'session_a',
        teamId: 'team_alpha',
      },
      tags: ['team', 'team_decision'],
      relatedFiles: ['.team/log.md'],
    })
  })

  it('records model resolution warning events as team log evidence', async () => {
    const store = makeWritableStore()
    const context = ledgerContext(store)

    await recordTeamEventEvidence({
      type: 'model_resolution_warning',
      memberId: 'member_api',
      requestedModelId: 'claude-opus-4-1',
      message: 'Configured model "claude-opus-4-1" is ambiguous. Use one of: official:claude-opus-4-1, proxy:claude-opus-4-1.',
      timestamp: 1_008,
    }, context)

    expect(store.saveDiagnostic).not.toHaveBeenCalled()
    expect(store.saveRawEvidence).toHaveBeenCalledTimes(1)
    expect(mockFirstArgs<RawEvidence>(store.saveRawEvidence)[0]).toMatchObject({
      content: expect.stringContaining('ambiguous'),
      metadata: expect.objectContaining({
        eventType: 'model_resolution_warning',
        memberId: 'member_api',
      }),
    })
  })

  it('records qa issue facts with deterministic ids while keeping all evidence raw', async () => {
    const store = makeWritableStore()
    const context = ledgerContext(store)

    await recordTeamArtifactEvidence({
      artifactId: 'report',
      artifactKind: 'artifact',
      artifactType: 'report',
      taskId: 'task_checkout',
      memberId: 'member_api',
      summary: 'Checkout report lists validation changes and regression notes.',
      path: '.team/tasks/task_checkout/artifacts/report.md',
    }, context)
    await recordTeamIssueEvidence({
      issueId: 'ISSUE-001',
      title: 'Checkout response missing validation error detail',
      status: 'open',
      severity: 'high',
      summary: 'Checkout response omits the validation detail.',
      taskId: 'task_checkout',
      memberId: 'member_qa',
      path: '.team/issues/ISSUE-001.md',
    }, context)
    await recordTeamIssueEvidence({
      issueId: 'ISSUE-001',
      title: 'Checkout response missing validation error detail',
      status: 'resolved',
      severity: 'high',
      summary: 'Checkout validation detail was restored.',
      taskId: 'task_checkout',
      memberId: 'member_qa',
      path: '.team/issues/ISSUE-001.md',
    }, context)
    await recordTeamTaskResultEvidence({
      taskId: 'task_checkout',
      memberId: 'member_api',
      summary: 'Checkout validation is fixed and regression notes are documented.',
      path: '.team/tasks/task_checkout/result.md',
    }, context)

    const facts = mockFirstArgs<ContextFact>(store.saveFact)
    // Ordinary artifacts and task results are work logs — raw evidence only, not
    // durable facts. Only the QA issues (actionable bugs) become project memory.
    expect(facts.map((fact) => [fact.id, fact.kind, fact.freshness])).toEqual([
      ['qa_issue_team_alpha_ISSUE_001', 'qa_issue', 'recent'],
      ['qa_issue_team_alpha_ISSUE_001', 'qa_issue', 'stale'],
    ])
    expect(mockFirstArgs<RawEvidence>(store.saveRawEvidence).map((evidence) => evidence.id)).toEqual([
      'team_artifact_team_alpha_task_checkout_report',
      'team_issue_team_alpha_ISSUE_001',
      'team_issue_team_alpha_ISSUE_001',
      'team_result_team_alpha_task_checkout',
    ])
  })

  it('retains raw evidence but never promotes task results or non-contract artifacts to durable facts', async () => {
    const store = makeWritableStore()
    const context = ledgerContext(store)

    // Task results are one-off work logs — raw evidence only, never a fact.
    await recordTeamTaskResultEvidence({
      taskId: 'task_real',
      memberId: 'member_api',
      summary: 'checkout API validation was fixed in src/api/checkout.ts.',
      path: '.team/tasks/task_real/result.md',
    }, context)
    // Ordinary artifact summaries are work logs too — raw evidence only.
    await recordTeamArtifactEvidence({
      artifactId: 'report',
      artifactKind: 'artifact',
      artifactType: 'report',
      taskId: 'task_real',
      memberId: 'member_api',
      summary: 'Checkout report lists validation changes and regression notes.',
      path: '.team/tasks/task_real/artifacts/report.md',
    }, context)
    // Contracts are explicit design agreements — promoted to a durable fact.
    await recordTeamArtifactEvidence({
      artifactId: 'api_contract',
      artifactKind: 'contract',
      taskId: 'task_real',
      memberId: 'member_api',
      summary: 'Checkout response envelope is frozen at v2.',
      path: '.team/contracts/api_contract.md',
    }, context)

    // All three are retained as raw evidence (team replay/synthesis unaffected).
    expect(store.saveRawEvidence).toHaveBeenCalledTimes(3)
    // Only the contract becomes a durable project memory fact.
    expect(mockFirstArgs<ContextFact>(store.saveFact).map((fact) => fact.id)).toEqual([
      'artifact_summary_team_alpha_task_real_api_contract',
    ])
  })
})

function makeStore(facts: ContextFact[]) {
  return {
    listAcceptedProjectFacts: vi.fn(async () => ({
      ok: true,
      value: facts,
      diagnostics: [],
    })),
    saveRawEvidence: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
    saveBundleSnapshot: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
    enforceQuotas: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
    saveDiagnostic: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
  } as any
}

function makeWritableStore() {
  return {
    saveRawEvidence: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
    saveFact: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
    saveDiagnostic: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
  }
}

function ledgerContext(store: ReturnType<typeof makeWritableStore>) {
  return {
    store,
    cwd: '/repo',
    sessionId: 'session_a',
    teamId: 'team_alpha',
    now: () => 2_000,
  }
}

function mockFirstArgs<T>(mock: { mock: { calls: unknown[][] } }): T[] {
  return mock.mock.calls.map((call) => call[0] as T)
}

function teamFact(overrides: Partial<ContextFact>): ContextFact {
  return {
    id: 'team_fact',
    kind: 'artifact_summary' as any,
    scope: 'project',
    content: 'Team fact',
    citations: [{ id: 'cit_team', type: 'task', ref: '.team/log.md' }],
    confidence: 0.92,
    freshness: 'recent',
    sourceProvider: 'TeamLedger',
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  }
}
