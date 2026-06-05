import { describe, expect, it, vi } from 'vitest'
import { mainSessionProfile } from './actor-profile.js'
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
    expect(store.listAcceptedProjectFacts).not.toHaveBeenCalled()
    expect(result.renderedPrompt).toBe('')
    expect(result.bundle.sections).toEqual([])
    expect(result.bundle.diagnostics[0]?.message).toContain('context injection disabled')
    expect(result.bundle.budget).toEqual({ usedTokens: 0, droppedTokens: 0 })
  })

  it('builds a ranked, budgeted bundle from live providers and stored facts, then persists evidence and snapshots', async () => {
    const runtime = section({ id: 'runtime_live', kind: 'runtime_state', content: 'live runtime error', priority: 10, freshness: 'live', confidence: 0.7, sourceProvider: 'RuntimeSignalProvider', tokenEstimate: 30 })
    const memory = fact({ id: 'memory_fact', kind: 'project_convention', content: 'cached preference', freshness: 'cached', confidence: 0.95 })
    const evidence = rawEvidence({ id: 'raw_runtime' })
    const store = makeStore({ facts: [memory] })

    const result = await buildContextBundle(request, {
      injectionEnabled: true,
      store,
      providers: [{ id: 'runtime', collect: async () => providerResult([runtime], [evidence]) }],
      now: () => 1_000,
      id: () => 'bundle_1',
    })

    expect(result.bundle.id).toBe('bundle_1')
    expect(result.bundle.sections.map((item) => item.id)).toEqual(['runtime_live', 'fact_memory_fact'])
    expect(result.bundle.budget).toEqual({ maxTokens: undefined, usedTokens: 35, droppedTokens: 0 })
    expect(result.renderedPrompt).toContain('<jdc-context-engine bundle="bundle_1">')
    expect(store.saveRawEvidence).toHaveBeenCalledWith(evidence)
    expect(store.saveBundleSnapshot).toHaveBeenCalledWith(result.bundle)
  })

  it('preserves actor profile metadata in the bundle and rendered prompt', async () => {
    const actorProfile = mainSessionProfile(request, 'Fix runtime cancellation bug')
    const store = makeStore({ facts: [fact({ id: 'memory_fact', kind: 'project_convention', content: 'Use JDC Context Engine naming.' })] })

    const result = await buildContextBundle(request, {
      injectionEnabled: true,
      store,
      providers: [],
      actorProfile,
      now: () => 1_000,
      id: () => 'bundle_actor_main',
    })

    expect(result.bundle.actorProfile).toEqual({
      actor: 'main_session',
      sessionId: 'session_1',
      objective: 'Fix runtime cancellation bug',
    })
    expect(result.renderedPrompt).toContain('<jdc-context-engine bundle="bundle_actor_main">')
    expect(result.renderedPrompt).toContain('<actor>main_session</actor>')
    expect(result.renderedPrompt).toContain('<objective>Fix runtime cancellation bug</objective>')
  })

  it('does not render live conversation transcript when messages already carry it', async () => {
    const duplicatedRecentChat = 'user: retry failed after tool result'
    const conversation = section({
      id: 'conversation_live',
      kind: 'conversation_state',
      title: 'Conversation state',
      content: duplicatedRecentChat,
      freshness: 'live',
      sourceProvider: 'ConversationSignalProvider',
      tokenEstimate: 8,
      ownership: { authority: 'derived_state', topic: 'conversation', conflictPolicy: 'suppress_if_carried' },
    })
    const runtime = section({
      id: 'runtime_live',
      kind: 'runtime_state',
      title: 'Runtime',
      content: 'tool result is already in the model transcript',
      freshness: 'live',
      sourceProvider: 'RuntimeSignalProvider',
      tokenEstimate: 8,
    })
    const store = makeStore({ facts: [] })

    const result = await buildContextBundle({ ...request, transcriptAlreadyInModel: true }, {
      injectionEnabled: true,
      store,
      providers: [
        { id: 'conversation', collect: async () => providerResult([conversation]) },
        { id: 'runtime', collect: async () => providerResult([runtime]) },
      ],
      now: () => 1_000,
      id: () => 'bundle_no_transcript_echo',
    })

    expect(result.bundle.sections.map((item) => item.id)).toEqual(['runtime_live'])
    expect(result.renderedPrompt).toContain('tool result is already in the model transcript')
    expect(result.renderedPrompt).not.toContain(duplicatedRecentChat)
    expect(result.bundle.diagnostics.some((item) =>
      item.source === 'ContextConflictResolver' &&
      item.message.includes('transcript_already_in_model_messages')
    )).toBe(true)
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
        fact({ id: 'fact_recent', kind: 'project_convention', content: 'recent project convention', freshness: 'recent' }),
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
      source: 'ContextRetriever',
      message: 'Suppressed stale low-value fact fact_stale.',
      visibleInPrimaryUi: false,
    }))
    expect(store.listAcceptedProjectFacts).toHaveBeenCalledWith(expect.objectContaining({
      minConfidence: 0.01,
      includeStale: true,
      includeExpired: false,
      orderBy: 'updated_desc',
    }))
    expect(store.listAcceptedProjectFacts).toHaveBeenCalledWith(expect.not.objectContaining({
      limit: expect.any(Number),
    }))
    expect(store.enforceQuotas).toHaveBeenCalledTimes(1)
  })

  it('injects query-relevant memory instead of recent irrelevant memory through retrieval', async () => {
    const facts = [
      ...Array.from({ length: 20 }, (_, index) => fact({
        id: `recent_irrelevant_${index}`,
        kind: 'user_preference',
        content: `Recent unrelated preference ${index}`,
        updatedAt: 10_000 + index,
      })),
      fact({
        id: 'release_process',
        kind: 'workflow_rule',
        content: 'JDCAGNET 发布流程：bump version，commit，tag vX.Y.Z，然后 push tag 触发 release workflow。',
        updatedAt: 1,
        confidence: 1,
      }),
    ]
    const store = makeStore({ facts })

    const result = await buildContextBundle({ ...request, userMessage: '我们的发布流程是咋样的' }, {
      injectionEnabled: true,
      store,
      providers: [],
      now: () => 20_000,
      id: () => 'bundle_release_memory',
    })

    expect(result.renderedPrompt).toContain('JDCAGNET 发布流程')
    expect(result.renderedPrompt).not.toContain('Recent unrelated preference')
    expect(store.listAcceptedProjectFacts).toHaveBeenCalledWith(expect.objectContaining({
      minConfidence: 0.01,
      includeStale: true,
      includeExpired: false,
      orderBy: 'updated_desc',
    }))
    expect(store.queryFacts).not.toHaveBeenCalled()
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

  it('keeps recent high-value goals without relying on a focused store fact window', async () => {
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

    const result = await buildContextBundle(request, {
      injectionEnabled: true,
      store,
      providers: [],
      now: () => 1_000,
      id: () => 'bundle_with_focused_goal',
    })

    expect(result.bundle.sections.map((item) => item.id)).toContain('fact_goal_recent')
    expect(result.renderedPrompt).toContain('Finish the task-aware context planner')
    expect(store.queryFacts).not.toHaveBeenCalled()
    expect(store.listAcceptedProjectFacts).toHaveBeenCalledTimes(1)
    expect(store.listAcceptedProjectFacts).toHaveBeenCalledWith(expect.not.objectContaining({
      limit: expect.any(Number),
      kinds: expect.any(Array),
    }))
  })

  it('does not impose a default project fact query window before planning', async () => {
    const genericFacts = Array.from({ length: 240 }, (_, index) => fact({
      id: `generic_${index}`,
      kind: 'project_convention',
      content: `Project convention ${index}`,
      confidence: 0.9,
      createdAt: index,
      updatedAt: index,
    }))
    const store = makeStore({ facts: genericFacts })

    const result = await buildContextBundle({ ...request, userMessage: 'Project convention 239' }, {
      injectionEnabled: true,
      store,
      providers: [],
      now: () => 1_000,
      id: () => 'bundle_without_store_limit',
    })

    expect(result.renderedPrompt).toContain('Project convention 239')
    for (const [query] of store.listAcceptedProjectFacts.mock.calls) {
      expect(query).not.toHaveProperty('limit')
    }
    expect(store.queryFacts).not.toHaveBeenCalled()
  })

  it('renders an agent run contract when required evidence is missing', async () => {
    const store = makeStore({ facts: [] })

    const result = await buildContextBundle({
      ...request,
      mode: 'code_edit',
      userMessage: '修复登录状态 bug',
    }, {
      injectionEnabled: true,
      includeAgentContract: true,
      store,
      providers: [],
      now: () => 1_000,
      id: () => 'bundle_agent_contract',
    })

    expect(result.renderedPrompt).toContain('<section kind="agent_contract"')
    expect(result.renderedPrompt).toContain('Code edit turns require target file or symbol evidence before mutation.')
    expect(result.bundle.sections.some((section) => section.kind === 'agent_contract')).toBe(true)
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
    listAcceptedProjectFacts: vi.fn(async (query: { minConfidence?: number; citationRef?: string; citationType?: string; limit?: number } = {}) => {
      if (options.queryError) throw options.queryError
      let facts = (options.facts ?? []).filter((fact) => fact.scope === 'project' || fact.scope === 'repo' || fact.scope === 'global')
      if (query.minConfidence !== undefined) facts = facts.filter((fact) => fact.confidence >= query.minConfidence!)
      if (query.citationRef) facts = facts.filter((fact) => fact.citations.some((citation) => citation.ref === query.citationRef))
      if (query.citationType) facts = facts.filter((fact) => fact.citations.some((citation) => citation.type === query.citationType))
      if (query.limit !== undefined) facts = facts.slice(0, query.limit)
      return { ok: true, value: facts, diagnostics: [] }
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
