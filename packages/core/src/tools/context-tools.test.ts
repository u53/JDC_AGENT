import { describe, expect, it, vi } from 'vitest'
import {
  ContextInspectPayloadSchema,
  createContextInspectTool,
  inspectContext,
} from './context-inspect.js'
import { ContextRefreshPayloadSchema, getContextProviderHealth, refreshContextProviders } from './context-refresh.js'
import { collectCodeContext, getCodeIndexJobStatus } from '../context/providers/code-provider.js'
import type { ContextBundle, ContextDiagnostic, ContextFact, ContextSection, HarvestJob, RawEvidence } from '../context/types.js'

const diagnostic: ContextDiagnostic = {
  id: 'diag_1',
  level: 'warning',
  source: 'TestProvider',
  message: 'provider stale',
  createdAt: 1_000,
}

describe('JDC Context Engine inspect and refresh tools', () => {
  it('returns latest injected bundle sections and accepted project facts while hiding operational harvest noise by default', async () => {
    const latest = bundle({ id: 'ctx_latest', createdAt: 2_000 })
    const store = makeStore({
      bundles: [bundle({ id: 'ctx_old', createdAt: 1_000 }), latest],
      acceptedProjectFacts: [fact({ id: 'project_rule', content: 'Run pnpm build before release.' })],
      harvestJobs: [harvestJob({ id: 'harvest_accepted', status: 'accepted' }), harvestJob({ id: 'harvest_failed', status: 'failed' })],
      rejectedCandidates: [{
        id: 'rejected_1',
        sessionId: 'session_1',
        status: 'rejected' as const,
        candidate: { kind: 'workflow_hint', content: 'uncited claim' },
        rejectionReason: 'durable context requires at least one citation',
        validationErrors: ['missing citation'],
        createdAt: 1_500,
        expiresAt: 9_999,
      }],
      diagnostics: [diagnostic],
    })

    const payload = await inspectContext({ sessionId: 'session_1' }, { store, now: () => 2_100 })

    expect(ContextInspectPayloadSchema.parse(payload).bundle?.id).toBe('ctx_latest')
    expect(payload.status).toBe('available')
    expect(payload.bundle?.sections[0]).toMatchObject({
      id: 'section_1',
      kind: 'runtime_state',
      confidence: 0.91,
      freshness: 'live',
      tokenCost: { tokenEstimate: 12 },
      citations: [{ id: 'cit_1', type: 'tool_event', ref: 'tool_1' }],
    })
    expect(payload.acceptedProjectFacts.map((item) => item.id)).toEqual(['project_rule'])
    expect(payload.harvestQueue.summary).toEqual({ queued: 0, classified: 0, distilling: 0, validating: 0, accepted: 0, rejected: 0, skipped: 0, failed: 0, pending_review: 0 })
    expect(payload.memoryReview.rejected).toEqual([])
    expect(payload.providerHealth).toEqual([])
    expect(payload.diagnostics.map((item) => item.id)).toContain('diag_1')
  })

  it('filters legacy aborted harvest artifacts and rejected candidates out of primary inspect diagnostics', async () => {
    const abortedDiagnostic = {
      id: 'diag_harvest_aborted',
      level: 'error' as const,
      source: 'Harvest',
      message: 'Harvest failed without blocking foreground chat: Request was aborted.',
      createdAt: 1_000,
    }
    const actionableDiagnostic = { ...diagnostic, id: 'diag_actionable', message: 'provider stale' }
    const store = makeStore({
      bundles: [bundle({ id: 'ctx_latest' })],
      harvestJobs: [
        harvestJob({ id: 'harvest_aborted', status: 'failed' as const }),
        harvestJob({ id: 'harvest_rejected', status: 'rejected' as const }),
      ],
      rejectedCandidates: [
        {
          id: 'rejected_abort',
          sessionId: 'session_1',
          status: 'rejected' as const,
          candidate: { preview: 'harvest candidate rejected' },
          rejectionReason: 'Harvest failed',
          validationErrors: ['Request was aborted.'],
          createdAt: 1_500,
          expiresAt: 9_999,
        },
        {
          id: 'rejected_actionable',
          sessionId: 'session_1',
          status: 'rejected' as const,
          candidate: { kind: 'workflow_hint' },
          rejectionReason: 'durable context requires at least one citation',
          validationErrors: ['missing citation'],
          createdAt: 1_600,
          expiresAt: 9_999,
        },
      ],
      diagnostics: [abortedDiagnostic, actionableDiagnostic],
    })

    const payload = await inspectContext({ sessionId: 'session_1' }, { store, now: () => 2_000 })

    expect(payload.diagnostics.map((item) => item.id)).toEqual(['diag_actionable'])
    expect(payload.memoryReview.rejected).toEqual([])
    expect(payload.harvestQueue.jobs).toEqual([])
    expect(payload.harvestQueue.summary.failed).toBe(0)
    expect(payload.harvestQueue.summary.rejected).toBe(0)
  })

  it('loads expired rejected memory review rows without full advanced diagnostics when requested', async () => {
    const expiredRejected = {
      id: 'rejected_expired',
      sessionId: 'session_1',
      status: 'rejected' as const,
      candidate: { kind: 'workflow_hint' },
      rejectionReason: 'durable context requires at least one citation',
      validationErrors: ['missing citation'],
      createdAt: 1_000,
      expiresAt: 1_500,
      visibleInPrimaryUi: true,
    }
    const store = makeStore({
      bundles: [bundle({ id: 'ctx_latest' })],
      rejectedCandidatesResult: { ok: true, value: [expiredRejected], diagnostics: [] },
    })

    const payload = await inspectContext({ sessionId: 'session_1', includeExpiredRejected: true }, { store, now: () => 2_000 })

    expect(store.listRejectedCandidates).toHaveBeenCalledWith({ sessionId: 'session_1', includeExpired: true })
    expect(payload.memoryReview.rejected.map((item) => item.id)).toEqual(['rejected_expired'])
    expect(payload.harvestQueue.jobs).toEqual([])
    expect(payload.advancedDiagnostics).toBeUndefined()
  })

  it('returns advanced diagnostics on request while collapsing model no-op rows into counts', async () => {
    const noopDiagnostic = {
      id: 'diag_harvest_noop',
      level: 'info' as const,
      source: 'Harvest',
      message: 'Harvest model skipped durable storage: model_noop',
      createdAt: 1_000,
      visibleInPrimaryUi: false,
    }
    const failedDiagnostic = {
      id: 'diag_harvest_failed',
      level: 'error' as const,
      source: 'Harvest',
      message: 'Harvest failed without blocking foreground chat: model error',
      createdAt: 1_100,
    }
    const store = makeStore({
      bundles: [bundle({ id: 'ctx_latest' })],
      harvestJobs: [
        harvestJob({ id: 'harvest_noop', status: 'skipped' as const, decision: { action: 'skip', reason: 'model_noop' } }),
        harvestJob({ id: 'harvest_failed', status: 'failed' as const }),
      ],
      rejectedCandidates: [
        {
          id: 'rejected_noop',
          sessionId: 'session_1',
          status: 'rejected' as const,
          candidate: { action: 'skip', reason: 'model_noop' },
          rejectionReason: 'Harvest model skipped durable storage: model_noop',
          validationErrors: ['model_noop'],
          createdAt: 1_500,
          expiresAt: 9_999,
          visibleInPrimaryUi: false,
        },
        {
          id: 'rejected_actionable',
          sessionId: 'session_1',
          status: 'rejected' as const,
          candidate: { kind: 'workflow_hint' },
          rejectionReason: 'durable context requires at least one citation',
          validationErrors: ['missing citation'],
          createdAt: 1_600,
          expiresAt: 9_999,
          visibleInPrimaryUi: true,
        },
      ],
      advancedDiagnostics: [noopDiagnostic, failedDiagnostic],
    })

    const payload = await inspectContext({ sessionId: 'session_1', includeAdvancedDiagnostics: true }, { store, now: () => 2_000 })

    expect(payload.diagnostics).toEqual([])
    expect(payload.advancedDiagnostics?.noop).toEqual({ rejected: 1, diagnostics: 1, harvestJobs: 1 })
    expect(payload.advancedDiagnostics?.rejected.map((item) => item.id)).toEqual(['rejected_actionable'])
    expect(payload.advancedDiagnostics?.diagnostics.map((item) => item.id)).toEqual(['diag_harvest_failed'])
    expect(payload.harvestQueue.jobs.map((job) => job.id)).toEqual(['harvest_failed'])
    expect(payload.memoryReview.rejected.map((item) => item.id)).toEqual(['rejected_actionable'])
  })

  it('returns an unavailable inspect payload instead of throwing when store reads fail', async () => {
    const store = makeStore({ bundlesResult: { ok: false, value: [], diagnostics: [diagnostic] } })
    const tool = createContextInspectTool({ store, now: () => 2_000 })

    const result = await tool.execute({ sessionId: 'session_1' }, { cwd: '/repo', turnIndex: 0 } as any)
    const parsed = JSON.parse(result.content)

    expect(result.isError).toBeFalsy()
    expect(parsed.status).toBe('unavailable')
    expect(parsed.diagnostics[0]).toMatchObject({ id: 'diag_1' })
  })

  it('parses non-blocking code provider health states in refresh payloads', async () => {
    const payload = {
      status: 'refreshed' as const,
      refreshedAt: 3_000,
      requestedProviders: ['code'],
      bundle: { ...bundle({ id: 'ctx_refresh_indexing', sections: [] }), sections: [] },
      providerHealth: [{
        id: 'code' as const,
        status: 'indexing',
        updatedAt: 3_000,
        diagnostic: { id: 'diag_code_indexing', level: 'warning' as const, source: 'CodeSignalProvider', message: 'Code index is building in the background.', createdAt: 3_000 },
      }],
      providerTimings: [{ id: 'code' as const, startedAt: 3_000, completedAt: 3_000, durationMs: 0, status: 'indexing' }],
      diagnostics: [],
    }

    expect(ContextRefreshPayloadSchema.parse(payload).providerHealth[0]?.status).toBe('indexing')
  })

  it('does not invent a legacy 2500 token budget for invalid refresh payloads', async () => {
    const payload = await refreshContextProviders({ sessionId: '' })

    expect(payload.status).toBe('unavailable')
    expect(payload.bundle.budget.maxTokens).toBeUndefined()
    expect(payload.bundle.budget.droppedTokens).toBe(0)
  })

  it('does not invent a legacy 2500 token budget for refresh bundles', async () => {
    const payload = await refreshContextProviders({ sessionId: 'session_1', cwd: '/repo', providers: [] }, {
      store: makeStore(),
      now: () => 1_000,
      id: () => 'ctx_refresh_no_cap',
    })

    expect(payload.status).toBe('refreshed')
    expect(payload.bundle.budget.maxTokens).toBeUndefined()
    expect(payload.bundle.budget.droppedTokens).toBe(0)
  })

  it('returns cached-only refresh state for an unindexed code provider without starting indexing', async () => {
    const releaseIndex = deferred<void>()
    const engine = {
      isIndexed: vi.fn(() => false),
      index: vi.fn(() => releaseIndex.promise),
    }
    const codeProvider = vi.fn((request) => collectCodeContext(request, { contextEngine: engine as any }))
    const store = makeStore()

    const payload = await refreshContextProviders({ sessionId: 'session_1', cwd: '/repo', providers: ['code'] }, {
      store,
      providers: [{ id: 'code', collect: codeProvider }],
      now: () => 3_000,
      id: () => 'ctx_refresh_not_indexed',
    })

    expect(ContextRefreshPayloadSchema.parse(payload).providerHealth[0]).toMatchObject({ id: 'code', status: 'not_indexed' })
    expect(payload.providerHealth[0]?.backgroundJob).toBeUndefined()
    expect(payload.bundle.sections).toEqual([])
    expect(codeProvider).toHaveBeenCalledTimes(1)
    expect(engine.index).not.toHaveBeenCalled()

    releaseIndex.resolve()
  })

  it('loads provider health without building bundles or starting code indexing', async () => {
    const releaseIndex = deferred<void>()
    const engine = {
      isIndexed: vi.fn(() => false),
      index: vi.fn(() => releaseIndex.promise),
    }
    const codeProvider = vi.fn((request) => collectCodeContext(request, { contextEngine: engine as any }))
    const codeHealth = vi.fn((request) => collectCodeContext(request, { contextEngine: engine as any, healthOnly: true }).then((result) => result.health))
    const store = makeStore()

    const providerHealth = await getContextProviderHealth({ sessionId: 'session_1', cwd: '/repo', providers: ['code'] }, {
      store,
      providers: [{ id: 'code', collect: codeProvider, health: codeHealth }],
      now: () => 3_000,
      id: () => 'ctx_should_not_persist',
    })

    expect(providerHealth[0]).toMatchObject({ id: 'code', status: 'not_indexed' })
    expect(providerHealth[0]?.backgroundJob).toBeUndefined()
    expect(codeProvider).not.toHaveBeenCalled()
    expect(codeHealth).toHaveBeenCalledTimes(1)
    expect(store.queryFacts).not.toHaveBeenCalled()
    expect(store.saveBundleSnapshot).not.toHaveBeenCalled()
    expect(store.saveRawEvidence).not.toHaveBeenCalled()
    expect(engine.index).not.toHaveBeenCalled()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(engine.index).not.toHaveBeenCalled()
    releaseIndex.resolve()
  })

  it('explicit code reindex enqueues a background job without awaiting or starting the full index before returning', async () => {
    const releaseIndex = deferred<void>()
    const engine = {
      isIndexed: vi.fn(() => false),
      index: vi.fn(() => releaseIndex.promise),
    }
    const store = makeStore()

    const payload = await refreshContextProviders({ sessionId: 'session_1', cwd: '/repo-explicit', providers: ['code'], reindex: true }, {
      store,
      providers: [{ id: 'code', collect: (request) => collectCodeContext(request, { contextEngine: engine as any }) }],
      now: () => 3_000,
      id: () => 'ctx_refresh_indexing',
    })

    expect(payload.providerHealth[0]).toMatchObject({ id: 'code', status: 'indexing', backgroundJob: { status: 'queued' } })
    expect(payload.bundle.sections).toEqual([])
    expect(engine.index).not.toHaveBeenCalled()

    const queued = getCodeIndexJobStatus('/repo-explicit')
    expect(queued).toMatchObject({ status: 'queued', cancelable: false })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(engine.index).toHaveBeenCalledTimes(1)
    expect(getCodeIndexJobStatus('/repo-explicit')).toMatchObject({ status: 'running', cancelable: false })

    releaseIndex.resolve()
    await releaseIndex.promise
  })

  it('refreshes selected providers and returns the inspected bundle plus provider health without mutating files', async () => {
    const runtimeProvider = vi.fn(async () => providerResult([section({ id: 'runtime_live', sourceProvider: 'RuntimeSignalProvider' })], [rawEvidence()]))
    const projectProvider = vi.fn(async () => providerResult([section({ id: 'project_live', kind: 'project_profile' })]))
    const store = makeStore()

    const payload = await refreshContextProviders({
      sessionId: 'session_1',
      cwd: '/repo',
      userMessage: 'refresh runtime',
      providers: ['runtime'],
      model: 'test-model',
    }, {
      store,
      providers: [
        { id: 'runtime', collect: runtimeProvider },
        { id: 'project', collect: projectProvider },
      ],
      now: () => 3_000,
      id: () => 'ctx_refresh',
    })

    expect(ContextRefreshPayloadSchema.parse(payload).bundle.id).toBe('ctx_refresh')
    expect(runtimeProvider).toHaveBeenCalledTimes(1)
    expect(projectProvider).not.toHaveBeenCalled()
    expect(payload.providerHealth).toEqual([{ id: 'runtime', status: 'enabled', updatedAt: 3_000 }])
    expect(payload.bundle.sections.map((item) => item.id)).toEqual(['runtime_live'])
  })
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function makeStore(options: Record<string, any> = {}) {
  const result = <T>(value: T) => ({ ok: true, value, diagnostics: [] })
  return {
    saveRawEvidence: vi.fn(async () => result(undefined)),
    saveFact: vi.fn(async () => result(undefined)),
    saveHarvestJob: vi.fn(async () => result(undefined)),
    updateHarvestJob: vi.fn(async () => result(undefined)),
    listHarvestJobs: vi.fn(async () => options.harvestJobsResult ?? result(options.harvestJobs ?? [])),
    rejectCandidate: vi.fn(async () => result(null)),
    saveBundleSnapshot: vi.fn(async () => result(undefined)),
    saveDiagnostic: vi.fn(async () => result(undefined)),
    queryFacts: vi.fn(async () => result([])),
    listAcceptedProjectFacts: vi.fn(async () => options.acceptedProjectFactsResult ?? result(options.acceptedProjectFacts ?? [])),
    listAdvancedDiagnostics: vi.fn(async () => options.advancedDiagnosticsResult ?? result({
      rejected: options.rejectedCandidates ?? [],
      diagnostics: options.advancedDiagnostics ?? [],
      harvestJobs: options.harvestJobs ?? [],
    })),
    invalidateByFileHash: vi.fn(async () => result({ invalidatedFacts: 0 })),
    enforceQuotas: vi.fn(async () => result({ deletedFacts: 0, deletedBundles: 0, deletedRawEvidence: 0, deletedRejectedCandidates: 0 })),
    getSchemaInfo: vi.fn(async () => result({ version: 1, dbPath: '/tmp/context.db' })),
    listBundleSnapshots: vi.fn(async () => options.bundlesResult ?? result(options.bundles ?? [])),
    listRawEvidence: vi.fn(async () => result([])),
    listRejectedCandidates: vi.fn(async () => options.rejectedCandidatesResult ?? result(options.rejectedCandidates ?? [])),
    listDiagnostics: vi.fn(async () => options.diagnosticsResult ?? result(options.diagnostics ?? [])),
    approvePendingCandidate: vi.fn(async () => ({ ok: true, value: null, diagnostics: [] })),
    rejectPendingCandidate: vi.fn(async () => ({ ok: true, value: null, diagnostics: [] })),
  }
}

function bundle(overrides: Partial<ContextBundle> = {}): ContextBundle {
  return {
    id: 'ctx_1',
    sessionId: 'session_1',
    requestHash: 'hash_1',
    createdAt: 1_000,
    sections: [section()],
    citations: [{ id: 'cit_1', type: 'tool_event', ref: 'tool_1' }],
    diagnostics: [],
    budget: { usedTokens: 12, droppedTokens: 0 },
    ...overrides,
  }
}

function section(overrides: Partial<ContextSection> = {}): ContextSection {
  return {
    id: 'section_1',
    kind: 'runtime_state',
    title: 'Runtime state',
    content: 'Recent tool chain',
    citations: [{ id: 'cit_1', type: 'tool_event', ref: 'tool_1' }],
    priority: 90,
    confidence: 0.91,
    freshness: 'live',
    sourceProvider: 'RuntimeSignalProvider',
    tokenEstimate: 12,
    ...overrides,
  }
}

function fact(overrides: Partial<ContextFact> = {}): ContextFact {
  return {
    id: 'fact_1',
    kind: 'workflow_rule',
    scope: 'project',
    content: 'Durable facts require proof-bound citations.',
    citations: [{ id: 'cit_1', type: 'tool_event', ref: 'tool_1' }],
    confidence: 0.91,
    freshness: 'recent',
    sourceProvider: 'TestProvider',
    createdAt: 1_000,
    updatedAt: 1_000,
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
    content: 'Read completed',
    metadata: { eventId: 'tool_1' },
    capturedAt: 3_000,
    hash: 'hash_1',
    ...overrides,
  }
}

function harvestJob(overrides: Partial<HarvestJob> = {}): HarvestJob {
  return {
    id: 'harvest_1',
    sessionId: 'session_1',
    runLoopId: 'run_1',
    status: 'queued',
    candidate: { sessionId: 'session_1', runLoopId: 'run_1', userMessage: 'remember this', assistantMessages: [], toolEvents: [], changedFiles: [], createdAt: 1_000 },
    modelBinding: { sessionId: 'session_1', providerProtocol: 'anthropic', modelId: 'model_1', modelConfig: { model: 'model_1', maxTokens: 100 } },
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  }
}

function providerResult(sections: ContextSection[], evidence: RawEvidence[] = []) {
  return { evidence, sections, diagnostics: [], health: { id: 'runtime' as const, status: 'enabled' as const, updatedAt: 3_000 } }
}
