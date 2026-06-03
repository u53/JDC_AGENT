import { describe, expect, it } from 'vitest'
import { buildContextBundle } from './orchestrator.js'
import { createContextPerformanceRecorder, recordContextOperation, summarizeContextPerformance } from './performance.js'
import { createContextScheduler } from './scheduler.js'
import type { ContextStore } from './store.js'
import type { ContextBundle, ContextFact } from './types.js'

describe('JDC Context Engine performance metrics', () => {
  it('summarizes operation counts, percentiles, and metadata without wall-clock assumptions', () => {
    const recorder = createContextPerformanceRecorder({ maxOperations: 10 })

    recorder.record({ name: 'context:retrieve-facts', lane: 'foreground', status: 'success', startedAt: 1_000, completedAt: 1_020, projectKey: '/repo', metadata: { factCount: 120 } })
    recorder.record({ name: 'context:retrieve-facts', lane: 'foreground', status: 'success', startedAt: 1_020, completedAt: 1_080, projectKey: '/repo', metadata: { factCount: 80 } })
    recorder.record({ name: 'context:harvest', lane: 'background', status: 'timeout', startedAt: 2_000, completedAt: 2_500, projectKey: '/repo', metadata: { runLoopId: 'run-1' } })

    const summary = summarizeContextPerformance(recorder.snapshot())

    expect(summary.totalOperations).toBe(3)
    expect(summary.byStatus.success).toBe(2)
    expect(summary.byStatus.timeout).toBe(1)
    expect(summary.byName['context:retrieve-facts']).toMatchObject({ count: 2, p50Ms: 20, p95Ms: 60, maxMs: 60 })
    expect(summary.slowest[0]).toMatchObject({ name: 'context:harvest', durationMs: 500, metadata: { runLoopId: 'run-1' } })
  })

  it('records async operation success and failure with metadata', async () => {
    let clock = 10
    const recorder = createContextPerformanceRecorder({ now: () => clock })

    const value = await recordContextOperation(recorder, {
      name: 'context:pack-assemble',
      lane: 'foreground',
      projectKey: '/repo',
      metadata: { sectionCount: 3 },
      now: () => clock,
    }, async () => {
      clock = 42
      return 'ok'
    })

    await expect(recordContextOperation(recorder, {
      name: 'context:store-write',
      lane: 'storage',
      projectKey: '/repo',
      now: () => clock,
    }, async () => {
      clock = 50
      throw new Error('db export failed')
    })).rejects.toThrow('db export failed')

    expect(value).toBe('ok')
    expect(recorder.snapshot().operations.map((operation) => operation.status)).toEqual(['success', 'failed'])
    expect(recorder.snapshot().operations[1].diagnostic).toBe('db export failed')
  })

  it('records retrieval and bundle assembly metrics while building a context pack', async () => {
    let clock = 1_000
    const recorder = createContextPerformanceRecorder({ now: () => clock })
    const scheduler = createContextScheduler({ recorder, now: () => clock })
    const store = makeStore(Array.from({ length: 200 }, (_, index) => performanceFact(index)))

    const result = await buildContextBundle({
      sessionId: 'session_1',
      cwd: '/repo',
      userMessage: 'performance budget project convention 199',
      recentMessages: [],
      mode: 'code_edit',
      model: 'test-model',
      runtime: {},
      createdAt: clock,
    }, {
      injectionEnabled: true,
      store,
      providers: [],
      scheduler,
      now: () => {
        clock += 5
        return clock
      },
      id: () => 'bundle_perf',
    })

    const operations = recorder.snapshot().operations
    const operationNames = operations.map((operation) => operation.name)
    const retrieveMetric = operations.find((operation) => operation.name === 'context:retrieve-facts')
    const packMetric = operations.find((operation) => operation.name === 'context:pack-assemble')

    expect(result.renderedPrompt).toContain('<jdc-context-engine bundle="bundle_perf">')
    expect(operationNames).toContain('context:retrieve-facts')
    expect(operationNames).toContain('context:pack-assemble')
    expect(retrieveMetric?.metadata?.candidateCount).toBe(200)
    expect(retrieveMetric?.metadata?.returnedCount).toBeGreaterThan(0)
    expect(packMetric?.metadata?.sectionCount).toBeGreaterThan(0)
    expect(packMetric?.metadata?.usedTokens).toBeGreaterThan(0)
    expect(packMetric?.metadata?.droppedTokens).toBe(0)
  })
})

function performanceFact(index: number): ContextFact {
  return {
    id: `performance_fact_${index}`,
    kind: 'project_convention',
    scope: 'project',
    content: `performance budget project convention ${index}`,
    citations: [{ id: `citation_${index}`, type: 'memory', ref: `memory_${index}` }],
    confidence: 0.9,
    freshness: 'recent',
    sourceProvider: 'MemorySignalProvider',
    createdAt: 1_000 + index,
    updatedAt: 1_000 + index,
  }
}

function makeStore(facts: ContextFact[]): ContextStore {
  return {
    saveRawEvidence: async () => ({ ok: true, value: undefined, diagnostics: [] }),
    saveFact: async () => ({ ok: true, value: undefined, diagnostics: [] }),
    saveHarvestJob: async () => ({ ok: true, value: undefined, diagnostics: [] }),
    updateHarvestJob: async () => ({ ok: true, value: undefined, diagnostics: [] }),
    listHarvestJobs: async () => ({ ok: true, value: [], diagnostics: [] }),
    rejectCandidate: async () => ({ ok: true, value: null, diagnostics: [] }),
    saveBundleSnapshot: async (_bundle: ContextBundle) => ({ ok: true, value: undefined, diagnostics: [] }),
    saveDiagnostic: async () => ({ ok: true, value: undefined, diagnostics: [] }),
    queryFacts: async () => ({ ok: true, value: facts, diagnostics: [] }),
    listAcceptedProjectFacts: async (query = {}) => {
      let result = facts
      if (query.minConfidence !== undefined) result = result.filter((fact) => fact.confidence >= query.minConfidence!)
      if (query.includeStale !== true) result = result.filter((fact) => fact.freshness !== 'stale')
      if (query.limit !== undefined) result = result.slice(0, query.limit)
      return { ok: true, value: result, diagnostics: [] }
    },
    listAdvancedDiagnostics: async () => ({ ok: true, value: { rejected: [], diagnostics: [], harvestJobs: [] }, diagnostics: [] }),
    invalidateByFileHash: async () => ({ ok: true, value: { invalidatedFacts: 0 }, diagnostics: [] }),
    enforceQuotas: async () => ({ ok: true, value: { deletedFacts: 0, deletedBundles: 0, deletedRawEvidence: 0, deletedRejectedCandidates: 0 }, diagnostics: [] }),
    getSchemaInfo: async () => ({ ok: true, value: { version: 1, dbPath: '/tmp/context.db' }, diagnostics: [] }),
    listBundleSnapshots: async () => ({ ok: true, value: [], diagnostics: [] }),
    listRawEvidence: async () => ({ ok: true, value: [], diagnostics: [] }),
    listRejectedCandidates: async () => ({ ok: true, value: [], diagnostics: [] }),
    approvePendingCandidate: async () => ({ ok: true, value: null, diagnostics: [] }),
    rejectPendingCandidate: async () => ({ ok: true, value: null, diagnostics: [] }),
    listDiagnostics: async () => ({ ok: true, value: [], diagnostics: [] }),
  }
}
