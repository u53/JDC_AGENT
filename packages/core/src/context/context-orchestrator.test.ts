import { describe, expect, it, vi } from 'vitest'
import { buildContextBundle } from './orchestrator.js'
import type { ContextStoreResult } from './store.js'
import type { ContextFact, ContextRequest, ContextSection, RawEvidence } from './types.js'

const request: ContextRequest = {
  sessionId: 'session_1',
  cwd: '/repo',
  userMessage: 'Fix the runtime cancellation bug',
  recentMessages: [],
  mode: 'code_edit',
  model: 'test-model',
  tokenBudget: 200,
  runtime: {},
  createdAt: 1_000,
}

describe('JDC Context orchestrator', () => {
  it('returns an inspectable disabled bundle without calling providers or store when context injection is disabled', async () => {
    const provider = vi.fn(async () => providerResult([section({ id: 'should_not_run' })]))
    const store = makeStore({ facts: [fact({ id: 'should_not_load' })] })

    const result = await buildContextBundle(request, {
      injectionEnabled: false,
      store,
      providers: [{ id: 'runtime', collect: provider }],
      now: () => 1_000,
      id: () => 'bundle_disabled',
    })

    expect(provider).not.toHaveBeenCalled()
    expect(store.queryFacts).not.toHaveBeenCalled()
    expect(result.renderedPrompt).toBe('')
    expect(result.bundle.sections).toEqual([])
    expect(result.bundle.diagnostics[0]?.message).toContain('context injection disabled')
    expect(result.bundle.budget).toEqual({ maxTokens: 200, usedTokens: 0, droppedTokens: 0 })
  })

  it('builds a ranked, budgeted bundle from live providers and stored facts, then persists evidence and snapshots', async () => {
    const runtime = section({ id: 'runtime_live', kind: 'runtime_state', content: 'live runtime error', priority: 10, freshness: 'live', confidence: 0.7, sourceProvider: 'RuntimeSignalProvider', tokenEstimate: 30 })
    const memory = fact({ id: 'memory_fact', content: 'cached preference', freshness: 'cached', confidence: 0.95 })
    const evidence = rawEvidence({ id: 'raw_runtime' })
    const store = makeStore({ facts: [memory] })

    const result = await buildContextBundle(request, {
      injectionEnabled: true,
      store,
      providers: [{ id: 'runtime', collect: async () => providerResult([runtime], [evidence]) }],
      maxSectionTokens: 100,
      now: () => 1_000,
      id: () => 'bundle_1',
    })

    expect(result.bundle.id).toBe('bundle_1')
    expect(result.bundle.sections.map((item) => item.id)).toEqual(['runtime_live', 'fact_memory_fact'])
    expect(result.bundle.budget).toEqual({ maxTokens: 200, usedTokens: 35, droppedTokens: 0 })
    expect(result.renderedPrompt).toContain('<jdc-context-engine bundle="bundle_1">')
    expect(result.renderedPrompt).not.toContain(request.userMessage)
    expect(store.saveRawEvidence).toHaveBeenCalledWith(evidence)
    expect(store.saveBundleSnapshot).toHaveBeenCalledWith(result.bundle)
  })

  it('does not drop large relevant sections when no explicit token caps are configured', async () => {
    const largeProjectSection = section({
      id: 'project_large',
      kind: 'project_profile',
      title: 'Project Primer',
      content: 'JDC Context Engine '.repeat(1200),
      tokenEstimate: 6000,
      priority: 90,
      sourceProvider: 'ProjectSignalProvider',
    })
    const store = makeStore({ facts: [] })

    const result = await buildContextBundle({ ...request, tokenBudget: undefined }, {
      injectionEnabled: true,
      store,
      providers: [{ id: 'project', collect: async () => providerResult([largeProjectSection]) }],
      maxSectionTokens: undefined,
      maxCodeTokens: undefined,
      now: () => 1_000,
      id: () => 'bundle_no_cap',
    })

    expect(result.dropped).toEqual([])
    expect(result.renderedPrompt).toContain('JDC Context Engine')
    expect(result.bundle.budget.maxTokens).toBeUndefined()
    expect(result.bundle.budget.usedTokens).toBeGreaterThanOrEqual(6000)
  })

  it('keeps high-value stale facts visible while suppressing stale low-value durable facts', async () => {
    const store = makeStore({
      facts: [
        fact({ id: 'fact_recent', content: 'recent project convention', freshness: 'recent' }),
        fact({ id: 'fact_known_issue', kind: 'known_issue', content: 'stale known issue still relevant', freshness: 'stale' }),
        fact({ id: 'fact_stale', kind: 'user_preference', content: 'stale old convention', freshness: 'stale' }),
      ],
    })

    const result = await buildContextBundle(request, {
      injectionEnabled: true,
      store,
      providers: [],
      now: () => 1_000,
      id: () => 'bundle_without_stale',
    })

    expect(result.renderedPrompt).toContain('recent project convention')
    expect(result.renderedPrompt).toContain('stale known issue still relevant')
    expect(result.renderedPrompt).not.toContain('stale old convention')
    expect(result.renderedPrompt).toContain('[stale]')
    expect(result.bundle.sections.map((item) => item.id)).toEqual(['fact_fact_recent', 'fact_fact_known_issue'])
    expect(result.bundle.diagnostics).toContainEqual(expect.objectContaining({
      source: 'ContextPlanner',
      message: 'Suppressed context section fact_fact_stale (memory "User Preference"): stale_low_value.',
      visibleInPrimaryUi: false,
    }))
    expect(store.queryFacts).toHaveBeenCalledWith({ minConfidence: 0.01, includeStale: true, limit: 200, orderBy: 'updated_desc' })
    expect(store.enforceQuotas).toHaveBeenCalledTimes(1)
  })

  it('persists hidden planner suppression diagnostics for advanced inspection', async () => {
    const store = makeStore({ facts: [] })
    const noop = section({ id: 'noop_diag', kind: 'diagnostics', title: 'Noop Diagnostic', content: 'model_noop', sourceProvider: 'Harvest' })

    const result = await buildContextBundle(request, {
      injectionEnabled: true,
      store,
      providers: [{ id: 'runtime', collect: async () => providerResult([noop]) }],
      now: () => 1_000,
      id: () => 'bundle_with_noop',
    })

    expect(result.bundle.sections.map((item) => item.id)).not.toContain('noop_diag')
    expect(result.renderedPrompt).not.toContain('model_noop')
    expect(result.bundle.diagnostics).toContainEqual(expect.objectContaining({
      source: 'ContextPlanner',
      message: 'Suppressed context section noop_diag (diagnostics "Noop Diagnostic"): low_salience_diagnostic.',
      visibleInPrimaryUi: false,
    }))
    expect(store.saveDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      source: 'ContextPlanner',
      message: 'Suppressed context section noop_diag (diagnostics "Noop Diagnostic"): low_salience_diagnostic.',
      visibleInPrimaryUi: false,
    }))
  })

  it('keeps recent high-value goals beyond the general store fact window', async () => {
    const genericFacts = Array.from({ length: 225 }, (_, index) => fact({
      id: `generic_${index}`,
      kind: 'user_preference',
      content: `Generic preference ${index}`,
      createdAt: index,
      updatedAt: index,
    }))
    const currentGoal = fact({
      id: 'goal_recent',
      kind: 'current_goal',
      content: 'Finish the task-aware context planner',
      confidence: 0.98,
      createdAt: 10_000,
      updatedAt: 10_000,
    })
    const store = makeStore({ facts: [...genericFacts, currentGoal] })

    const result = await buildContextBundle({ ...request, tokenBudget: 80 }, {
      injectionEnabled: true,
      store,
      providers: [],
      now: () => 1_000,
      id: () => 'bundle_with_focused_goal',
    })

    expect(result.bundle.sections.map((item) => item.id)).toContain('fact_goal_recent')
    expect(result.renderedPrompt).toContain('Finish the task-aware context planner')
    expect(store.queryFacts).toHaveBeenCalledWith(expect.objectContaining({
      kinds: ['current_goal', 'known_issue', 'project_convention', 'architecture_decision', 'runtime_error_chain'],
      includeStale: true,
    }))
  })

  it('adds provider diagnostics and continues when one provider fails', async () => {
    const store = makeStore({ facts: [] })

    const result = await buildContextBundle(request, {
      injectionEnabled: true,
      store,
      providers: [
        { id: 'runtime', collect: async () => { throw new Error('runtime provider failed') } },
        { id: 'conversation', collect: async () => providerResult([section({ id: 'conversation_live', kind: 'conversation_state', content: 'conversation still included' })]) },
      ],
      now: () => 1_000,
      id: () => 'bundle_2',
    })

    expect(result.bundle.sections.map((item) => item.id)).toContain('conversation_live')
    expect(result.bundle.diagnostics.some((diagnostic) => diagnostic.message.includes('runtime provider failed'))).toBe(true)
    expect(result.renderedPrompt).toContain('conversation still included')
  })

  it('falls back to an empty diagnostic bundle when bundle generation fails before rendering', async () => {
    const result = await buildContextBundle(request, {
      injectionEnabled: true,
      store: makeStore({ queryError: new Error('store unavailable') }),
      providers: [{ id: 'runtime', collect: async () => providerResult([section()]) }],
      now: () => 1_000,
      id: () => 'bundle_fallback',
    })

    expect(result.bundle.id).toBe('bundle_fallback')
    expect(result.bundle.sections).toEqual([])
    expect(result.bundle.diagnostics[0]?.level).toBe('error')
    expect(result.bundle.diagnostics[0]?.message).toContain('store unavailable')
    expect(result.renderedPrompt).toBe('')
  })

  it('returns a degraded bundle with diagnostics when evidence persistence returns ok false', async () => {
    const evidenceDiagnostic = {
      id: 'diag_raw_evidence_failed',
      level: 'error' as const,
      source: 'ContextStore',
      message: 'raw evidence write failed',
      createdAt: 1_000,
    }
    const store = makeStore({ saveRawEvidenceResult: { ok: false, value: undefined, diagnostics: [evidenceDiagnostic] } })

    const result = await buildContextBundle(request, {
      injectionEnabled: true,
      store,
      providers: [{ id: 'runtime', collect: async () => providerResult([section({ id: 'runtime_live' })], [rawEvidence()]) }],
      now: () => 1_000,
      id: () => 'bundle_degraded_raw',
    })

    expect(result.bundle.sections.map((item) => item.id)).toContain('runtime_live')
    expect(result.renderedPrompt).toContain('Context content')
    expect(result.bundle.diagnostics).toContainEqual(evidenceDiagnostic)
    expect(store.saveDiagnostic).toHaveBeenCalledWith(evidenceDiagnostic)
  })

  it('returns a degraded bundle with diagnostics when snapshot persistence returns ok false', async () => {
    const snapshotDiagnostic = {
      id: 'diag_snapshot_failed',
      level: 'error' as const,
      source: 'ContextStore',
      message: 'snapshot write failed',
      createdAt: 1_000,
    }
    const store = makeStore({ saveBundleSnapshotResult: { ok: false, value: undefined, diagnostics: [snapshotDiagnostic] } })

    const result = await buildContextBundle(request, {
      injectionEnabled: true,
      store,
      providers: [{ id: 'runtime', collect: async () => providerResult([section({ id: 'runtime_live' })]) }],
      now: () => 1_000,
      id: () => 'bundle_degraded_snapshot',
    })

    expect(result.bundle.sections.map((item) => item.id)).toContain('runtime_live')
    expect(result.renderedPrompt).toContain('Context content')
    expect(result.bundle.diagnostics).toContainEqual(snapshotDiagnostic)
    expect(store.saveDiagnostic).toHaveBeenCalledWith(snapshotDiagnostic)
  })
})

function section(overrides: Partial<ContextSection> = {}): ContextSection {
  return {
    id: 'section_1',
    kind: 'runtime_state',
    title: 'Runtime state',
    content: 'Context content',
    citations: [{ id: 'cit_1', type: 'tool_event', ref: 'tool_1' }],
    priority: 50,
    confidence: 0.8,
    freshness: 'live',
    sourceProvider: 'TestProvider',
    tokenEstimate: 20,
    ...overrides,
  }
}

function fact(overrides: Partial<ContextFact> = {}): ContextFact {
  return {
    id: 'fact_1',
    kind: 'user_preference',
    scope: 'project',
    content: 'Use JDC Context Engine name.',
    citations: [{ id: 'cit_fact_1', type: 'memory', ref: 'memory_1' }],
    confidence: 0.9,
    freshness: 'recent',
    sourceProvider: 'MemorySignalProvider',
    createdAt: 100,
    updatedAt: 900,
    ...overrides,
  }
}

function rawEvidence(overrides: Partial<RawEvidence> = {}): RawEvidence {
  return {
    id: 'raw_1',
    sessionId: 'session_1',
    cwd: '/repo',
    sourceProvider: 'RuntimeSignalProvider',
    kind: 'tool_event',
    content: 'tool failed',
    metadata: {},
    capturedAt: 1_000,
    hash: 'hash_1',
    ...overrides,
  }
}

function providerResult(sections: ContextSection[], evidence: RawEvidence[] = []) {
  return { evidence, sections, diagnostics: [], health: { id: 'runtime' as const, status: 'enabled' as const, updatedAt: 1_000 } }
}

function makeStore(options: { facts?: ContextFact[]; queryError?: Error; saveRawEvidenceResult?: ContextStoreResult; saveBundleSnapshotResult?: ContextStoreResult } = {}) {
  return {
    saveRawEvidence: vi.fn(async () => options.saveRawEvidenceResult ?? ({ ok: true, value: undefined, diagnostics: [] })),
    saveFact: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
    saveHarvestJob: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
    updateHarvestJob: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
    listHarvestJobs: vi.fn(async () => ({ ok: true, value: [], diagnostics: [] })),
    rejectCandidate: vi.fn(async () => ({ ok: true, value: null, diagnostics: [] })),
    saveBundleSnapshot: vi.fn(async () => options.saveBundleSnapshotResult ?? ({ ok: true, value: undefined, diagnostics: [] })),
    saveDiagnostic: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
    queryFacts: vi.fn(async (query: { scope?: ContextFact['scope']; freshness?: ContextFact['freshness']; minConfidence?: number; includeStale?: boolean; limit?: number; kinds?: ContextFact['kind'][]; orderBy?: 'updated_desc' | 'updated_asc' } = {}) => {
      if (options.queryError) throw options.queryError
      let facts = options.facts ?? []
      if (query.scope) facts = facts.filter((fact) => fact.scope === query.scope)
      if (query.kinds) facts = facts.filter((fact) => query.kinds!.includes(fact.kind))
      if (query.freshness) facts = facts.filter((fact) => fact.freshness === query.freshness)
      else if (!query.includeStale) facts = facts.filter((fact) => fact.freshness !== 'stale')
      if (query.minConfidence !== undefined) facts = facts.filter((fact) => fact.confidence >= query.minConfidence!)
      if (query.orderBy === 'updated_desc') facts = [...facts].sort((a, b) => b.updatedAt - a.updatedAt)
      if (query.orderBy === 'updated_asc') facts = [...facts].sort((a, b) => a.updatedAt - b.updatedAt)
      if (query.limit !== undefined) facts = facts.slice(0, query.limit)
      return { ok: true, value: facts, diagnostics: [] }
    }),
    listAcceptedProjectFacts: vi.fn(async () => {
      if (options.queryError) throw options.queryError
      return { ok: true, value: (options.facts ?? []).filter((fact) => fact.scope === 'project' || fact.scope === 'repo' || fact.scope === 'global'), diagnostics: [] }
    }),
    listAdvancedDiagnostics: vi.fn(async () => ({ ok: true, value: { rejected: [], diagnostics: [], harvestJobs: [] }, diagnostics: [] })),
    invalidateByFileHash: vi.fn(async () => ({ ok: true, value: { invalidatedFacts: 0 }, diagnostics: [] })),
    enforceQuotas: vi.fn(async () => ({ ok: true, value: { deletedFacts: 0, deletedBundles: 0, deletedRawEvidence: 0, deletedRejectedCandidates: 0 }, diagnostics: [] })),
    getSchemaInfo: vi.fn(async () => ({ ok: true, value: { version: 1, dbPath: '/tmp/context.db' }, diagnostics: [] })),
    listBundleSnapshots: vi.fn(async () => ({ ok: true, value: [], diagnostics: [] })),
    listRawEvidence: vi.fn(async () => ({ ok: true, value: [], diagnostics: [] })),
    listRejectedCandidates: vi.fn(async () => ({ ok: true, value: [], diagnostics: [] })),
    listDiagnostics: vi.fn(async () => ({ ok: true, value: [], diagnostics: [] })),
    approvePendingCandidate: vi.fn(async () => ({ ok: true, value: null, diagnostics: [] })),
    rejectPendingCandidate: vi.fn(async () => ({ ok: true, value: null, diagnostics: [] })),
  }
}
