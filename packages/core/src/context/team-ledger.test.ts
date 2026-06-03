import { describe, expect, it, vi } from 'vitest'
import { ContextFactSchema } from './schemas.js'
import { buildContextBundle } from './orchestrator.js'
import type { ContextFact, ContextRequest } from './types.js'

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
