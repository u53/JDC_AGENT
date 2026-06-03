import { describe, expect, it, vi } from 'vitest'
import { mainSessionProfile, subAgentProfile, teamPmProfile, teamWorkerProfile } from './actor-profile.js'
import { retrieveContextFacts } from './retriever.js'
import type { ContextFact, ContextRequest } from './types.js'

const request: ContextRequest = {
  sessionId: 'session_main',
  cwd: '/repo',
  userMessage: '继续处理 checkout task 和上线前流程',
  recentMessages: [],
  mode: 'code_edit',
  model: 'test-model',
  runtime: {},
  createdAt: 1_000,
}

describe('JDC Context actor-aware context packs', () => {
  it('keeps project facts shared while ranking a Team PM pack toward team decisions and issues', async () => {
    const store = makeStore(sharedFactPool())
    const actorProfile = teamPmProfile({
      sessionId: 'session_pm_b',
      cwd: '/repo',
      mode: 'plan',
      objective: 'Review team_alpha checkout task risks and open issues',
      teamId: 'team_alpha',
    })

    const result = await retrieveContextFacts({ ...request, sessionId: 'session_pm_b', userMessage: 'team_alpha checkout task risks' }, {
      store,
      actorProfile,
      now: () => 20_000,
    })

    expect(result.facts.map((item) => item.fact.id).slice(0, 2)).toEqual(['pm_checkout_issue', 'pm_checkout_decision'])
    expect(result.facts[0]?.reasons).toContain('actor_pm_priority')
    expect(result.facts[0]?.reasons).toContain('actor_team_match')
    expect(store.listAcceptedProjectFacts).toHaveBeenCalledWith(expect.not.objectContaining({
      sessionId: expect.any(String),
      limit: expect.any(Number),
    }))
  })

  it('ranks a Team worker pack toward assigned task, member, and file scope before generic project memory', async () => {
    const store = makeStore(sharedFactPool())
    const actorProfile = teamWorkerProfile({
      sessionId: 'session_worker_b',
      cwd: '/repo',
      mode: 'code_edit',
      objective: 'Implement checkout API fix',
      teamId: 'team_alpha',
      memberId: 'member_api',
      taskId: 'task_checkout',
      fileScope: ['/repo/src/api/checkout.ts'],
    })

    const result = await retrieveContextFacts({ ...request, sessionId: 'session_worker_b', userMessage: '继续实现 src/api/checkout.ts' }, {
      store,
      actorProfile,
      now: () => 20_000,
    })

    expect(result.facts.map((item) => item.fact.id).slice(0, 2)).toEqual(['worker_checkout_result', 'project_release_rule'])
    expect(result.facts[0]?.reasons).toEqual(expect.arrayContaining([
      'actor_worker_priority',
      'actor_task_match',
      'actor_member_match',
      'actor_file_scope_match',
    ]))
  })

  it('keeps main-session packs away from raw worker logs while retaining durable project context', async () => {
    const store = makeStore(sharedFactPool())
    const actorProfile = mainSessionProfile({ ...request, userMessage: 'checkout task worker log 和上线流程' })

    const result = await retrieveContextFacts({ ...request, userMessage: 'checkout task worker log 和上线流程' }, {
      store,
      actorProfile,
      now: () => 20_000,
    })

    expect(result.facts.map((item) => item.fact.id)).toContain('project_release_rule')
    expect(result.facts.map((item) => item.fact.id)).toContain('pm_checkout_decision')
    expect(result.facts.map((item) => item.fact.id)).not.toContain('raw_worker_log')
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      source: 'ContextRetriever',
      message: expect.stringContaining('raw_worker_log'),
      visibleInPrimaryUi: false,
    }))
  })

  it('ranks subagent packs toward parent objective and project/code facts instead of unrelated recent chat', async () => {
    const store = makeStore(sharedFactPool())
    const actorProfile = subAgentProfile({
      sessionId: 'session_sub_b',
      cwd: '/repo',
      mode: 'code_edit',
      objective: 'Inspect context injection entrypoint in session.ts',
      subSessionId: 'sub_1',
      parentObjective: 'Fix JDC Context Engine injection',
      fileScope: ['packages/core/src/session.ts'],
    })

    const result = await retrieveContextFacts({ ...request, sessionId: 'session_sub_b', userMessage: 'context injection session.ts' }, {
      store,
      actorProfile,
      now: () => 20_000,
    })

    expect(result.facts.map((item) => item.fact.id)[0]).toBe('context_injection_entrypoint')
    expect(result.facts[0]?.reasons).toContain('actor_subagent_project_priority')
    expect(result.facts.map((item) => item.fact.id)).not.toContain('unrelated_recent_chat')
  })
})

function makeStore(facts: ContextFact[]) {
  return {
    listAcceptedProjectFacts: vi.fn(async (query: { limit?: number } = {}) => ({
      ok: true,
      value: query.limit === undefined ? facts : facts.slice(0, query.limit),
      diagnostics: [],
    })),
  } as any
}

function sharedFactPool(): ContextFact[] {
  return [
    fact({
      id: 'project_release_rule',
      kind: 'workflow_rule',
      content: '项目约定：上线前必须运行 pnpm build，并确认 checkout API 回归测试通过。',
      citations: [{ id: 'cit_release', type: 'memory', ref: 'project-conventions' }],
      updatedAt: 10,
      origin: { projectKey: '/repo', actor: 'user', sessionId: 'session_a' },
      tags: ['release', 'workflow'],
    }),
    fact({
      id: 'pm_checkout_issue',
      kind: 'known_issue',
      content: 'Team team_alpha open issue: checkout task still has API contract mismatch risk.',
      citations: [{ id: 'cit_issue', type: 'task', ref: '.team/issues/ISSUE-checkout.md' }],
      updatedAt: 40,
      origin: { projectKey: '/repo', actor: 'team_pm', sessionId: 'session_a', teamId: 'team_alpha', taskId: 'task_checkout' },
      tags: ['team_issue'],
      relatedTasks: ['task_checkout'],
    }),
    fact({
      id: 'pm_checkout_decision',
      kind: 'architecture_decision',
      content: 'PM decision for team_alpha: checkout API keeps existing response envelope and only fixes validation.',
      citations: [{ id: 'cit_decision', type: 'task', ref: '.team/log.md' }],
      updatedAt: 35,
      origin: { projectKey: '/repo', actor: 'team_pm', sessionId: 'session_a', teamId: 'team_alpha', taskId: 'task_checkout' },
      tags: ['team_decision'],
      relatedTasks: ['task_checkout'],
    }),
    fact({
      id: 'worker_checkout_result',
      kind: 'module_boundary',
      content: 'Worker member_api result: checkout API implementation is in src/api/checkout.ts and must preserve CheckoutResponse.',
      citations: [{ id: 'cit_checkout_file', type: 'file', ref: 'src/api/checkout.ts' }],
      updatedAt: 30,
      origin: { projectKey: '/repo', actor: 'team_worker', sessionId: 'session_a', teamId: 'team_alpha', memberId: 'member_api', taskId: 'task_checkout' },
      tags: ['task_result'],
      relatedFiles: ['src/api/checkout.ts'],
      relatedTasks: ['task_checkout'],
    }),
    fact({
      id: 'raw_worker_log',
      kind: 'current_goal',
      content: 'Raw worker log: member_api tried tool calls while debugging checkout task worker log output.',
      citations: [{ id: 'cit_worker_log', type: 'task', ref: '.team/log.md' }],
      updatedAt: 45,
      origin: { projectKey: '/repo', actor: 'team_worker', sessionId: 'session_a', teamId: 'team_alpha', memberId: 'member_api', taskId: 'task_checkout' },
      tags: ['worker_log', 'raw_worker_log'],
      relatedTasks: ['task_checkout'],
    }),
    fact({
      id: 'context_injection_entrypoint',
      kind: 'code_entrypoint',
      content: 'JDC Context Engine injection entrypoint is Session.injectContextForRunLoop in packages/core/src/session.ts.',
      citations: [{ id: 'cit_session', type: 'file', ref: 'packages/core/src/session.ts' }],
      updatedAt: 20,
      origin: { projectKey: '/repo', actor: 'main_session', sessionId: 'session_a' },
      relatedFiles: ['packages/core/src/session.ts'],
    }),
    fact({
      id: 'unrelated_recent_chat',
      kind: 'current_goal',
      content: 'Recent unrelated chat: user discussed lunch and small talk unrelated to context injection.',
      citations: [{ id: 'cit_chat', type: 'message', ref: 'message_recent' }],
      updatedAt: 50,
      origin: { projectKey: '/repo', actor: 'main_session', sessionId: 'session_a' },
      tags: ['conversation'],
    }),
  ]
}

function fact(overrides: Partial<ContextFact> = {}): ContextFact {
  return {
    id: 'fact_1',
    kind: 'workflow_rule',
    scope: 'project',
    content: 'Run pnpm build before release.',
    citations: [{ id: 'cit_1', type: 'memory', ref: 'memory_1' }],
    confidence: 0.92,
    freshness: 'recent',
    sourceProvider: 'EvalProvider',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}
