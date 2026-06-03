import { describe, expect, it, vi } from 'vitest'
import { retrieveContextFacts } from './retriever.js'
import type { ContextFact, ContextRequest } from './types.js'

const request: ContextRequest = {
  sessionId: 'session_1',
  cwd: '/repo',
  userMessage: '我们的发布流程是咋样的',
  recentMessages: [],
  mode: 'chat',
  model: 'test-model',
  runtime: {},
  createdAt: 1_000,
}

describe('ContextRetriever', () => {
  it('retrieves old relevant workflow memory ahead of newer irrelevant facts without a hidden candidate cap', async () => {
    const facts = [
      ...Array.from({ length: 120 }, (_, index) => fact({
        id: `recent_irrelevant_${index}`,
        kind: 'user_preference',
        content: `Recent unrelated preference ${index}`,
        updatedAt: 10_000 + index,
      })),
      fact({
        id: 'old_release_flow',
        kind: 'workflow_rule',
        content: 'JDCAGNET 发布流程：修改 packages/electron/package.json version，提交 bump commit，打 tag，然后 push tag 触发 release workflow。',
        updatedAt: 1,
        confidence: 1,
      }),
    ]
    const store = makeStore(facts)

    const result = await retrieveContextFacts(request, { store, now: () => 20_000 })

    expect(result.facts.map((item) => item.fact.id)).toEqual(['old_release_flow'])
    expect(result.facts[0]?.reasons).toContain('query_match')
    expect(store.listAcceptedProjectFacts).toHaveBeenCalledWith(expect.objectContaining({
      minConfidence: 0.01,
      includeStale: true,
      includeExpired: false,
      orderBy: 'updated_desc',
    }))
    expect(store.listAcceptedProjectFacts).toHaveBeenCalledWith(expect.not.objectContaining({
      limit: expect.any(Number),
    }))
  })

  it('does not return stale low-value facts by default', async () => {
    const store = makeStore([
      fact({ id: 'stale_pref', kind: 'user_preference', content: 'Use the old release process.', freshness: 'stale' }),
      fact({ id: 'recent_rule', kind: 'workflow_rule', content: 'Use the current release workflow.', freshness: 'recent' }),
    ])

    const result = await retrieveContextFacts({ ...request, userMessage: 'release workflow' }, { store, now: () => 20_000 })

    expect(result.facts.map((item) => item.fact.id)).toEqual(['recent_rule'])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      source: 'ContextRetriever',
      message: expect.stringContaining('stale_pref'),
      visibleInPrimaryUi: false,
    }))
  })

  it('supports citation and path matching for workflow files', async () => {
    const store = makeStore([
      fact({
        id: 'release_yaml_rule',
        kind: 'workflow_rule',
        content: 'Release workflow is defined in GitHub Actions.',
        citations: [{ id: 'cit_release_yml', type: 'file', ref: '.github/workflows/release.yml' }],
      }),
    ])

    const result = await retrieveContextFacts({ ...request, userMessage: 'release.yml 是干嘛的' }, { store, now: () => 20_000 })

    expect(result.facts.map((item) => item.fact.id)).toEqual(['release_yaml_rule'])
    expect(result.facts[0]?.reasons).toContain('citation_match')
  })

  it('honors an explicit result limit when query is empty', async () => {
    const store = makeStore([
      fact({ id: 'rule_1', kind: 'workflow_rule', content: 'Run pnpm build before release.', updatedAt: 10 }),
      fact({ id: 'rule_2', kind: 'project_convention', content: 'Use JDC Context Engine naming.', updatedAt: 20 }),
      fact({ id: 'rule_3', kind: 'known_issue', content: 'Renderer can freeze on full refresh.', updatedAt: 30 }),
    ])

    const result = await retrieveContextFacts({ ...request, userMessage: '' }, { store, limit: 2, now: () => 20_000 })

    expect(result.facts.map((item) => item.fact.id)).toEqual(['rule_3', 'rule_2'])
  })

  it('honors an explicit candidate limit without introducing a default one', async () => {
    const store = makeStore([
      fact({ id: 'candidate_1', content: 'Candidate one' }),
      fact({ id: 'candidate_2', content: 'Candidate two' }),
    ])

    await retrieveContextFacts({ ...request, userMessage: '' }, { store, candidateLimit: 1, now: () => 20_000 })

    expect(store.listAcceptedProjectFacts).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }))
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
