import { describe, expect, it, vi } from 'vitest'
import { inspectContext } from './context-inspect.js'
import { createDefaultRefreshProviders, getContextProviderHealth } from './context-refresh.js'

describe('JDC Context Engine repo wiki inspect visibility', () => {
  it('includes repo wiki summary in inspect payload without triggering entry reads', async () => {
    const store = makeStore({ repoWikiSummary: { activeEntries: 2, staleEntries: 1, lastGeneratedAt: 1_700_000_000_000, lastModelId: 'claude-sonnet-4', lastDiagnostic: 'cached diagnostic' } })

    const payload = await inspectContext({ sessionId: 'sess-1', includeAdvancedDiagnostics: true }, { store, cwd: '/repo', now: () => 1_700_000_000_100 })

    expect(payload.repoWiki).toEqual({
      activeEntries: 2,
      staleEntries: 1,
      lastGeneratedAt: 1_700_000_000_000,
      lastModelId: 'claude-sonnet-4',
      lastDiagnostic: 'cached diagnostic',
    })
    expect(store.getRepoWikiSummary).toHaveBeenCalledTimes(1)
    expect(store.listRepoWikiEntries).not.toHaveBeenCalled()
  })

  it('samples repo wiki entries only when explicitly requested', async () => {
    const store = makeStore({
      repoWikiSummary: { activeEntries: 1, staleEntries: 0, lastGeneratedAt: 1_700_000_000_000, lastModelId: 'claude-sonnet-4' },
      repoWikiEntries: [repoWikiEntry()],
    })

    const payload = await inspectContext({ sessionId: 'sess-1', includeRepoWikiSamples: true }, { store, cwd: '/repo', now: () => 1_700_000_000_100 })

    expect(payload.repoWiki?.samples).toEqual([
      expect.objectContaining({ id: 'wiki_session', title: 'Session architecture', citationRefs: ['packages/core/src/session.ts'] }),
    ])
    expect(store.listRepoWikiEntries).toHaveBeenCalledWith({ includeStale: true, includeArchived: false })
  })

  it('reads default repo wiki provider health without queuing generation', async () => {
    const store = makeStore({ repoWikiSummary: { activeEntries: 0, staleEntries: 2, lastGeneratedAt: 1_700_000_000_000, lastModelId: 'claude-sonnet-4' } })

    const health = await getContextProviderHealth({ sessionId: 'sess-1', cwd: '/repo', providers: ['repo_wiki'] }, {
      store,
      providers: createDefaultRefreshProviders({ providerToggles: { repo_wiki: true } }, { store }),
      now: () => 1_700_000_000_100,
    })

    expect(health).toEqual([
      expect.objectContaining({
        id: 'repo_wiki',
        status: 'stale',
        diagnostic: expect.objectContaining({ source: 'RepoWikiProvider', message: expect.stringContaining('active=0 stale=2') }),
      }),
    ])
    expect(store.getRepoWikiSummary).toHaveBeenCalledTimes(1)
    expect(store.listRepoWikiEntries).not.toHaveBeenCalled()
    expect(store.saveRepoWikiEntries).not.toHaveBeenCalled()
  })
})

function makeStore(options: Record<string, any> = {}) {
  const result = <T>(value: T) => ({ ok: true, value, diagnostics: [] })
  return {
    saveRawEvidence: vi.fn(async () => result(undefined)),
    saveFact: vi.fn(async () => result(undefined)),
    saveHarvestJob: vi.fn(async () => result(undefined)),
    updateHarvestJob: vi.fn(async () => result(undefined)),
    listHarvestJobs: vi.fn(async () => result([])),
    rejectCandidate: vi.fn(async () => result(null)),
    saveBundleSnapshot: vi.fn(async () => result(undefined)),
    saveDiagnostic: vi.fn(async () => result(undefined)),
    queryFacts: vi.fn(async () => result([])),
    listAcceptedProjectFacts: vi.fn(async () => result([])),
    listAdvancedDiagnostics: vi.fn(async () => result({ rejected: [], diagnostics: [], harvestJobs: [] })),
    invalidateByFileHash: vi.fn(async () => result({ invalidatedFacts: 0 })),
    enforceQuotas: vi.fn(async () => result({ deletedFacts: 0, deletedBundles: 0, deletedRawEvidence: 0, deletedRejectedCandidates: 0 })),
    getSchemaInfo: vi.fn(async () => result({ version: 1, dbPath: '/tmp/context.db' })),
    listBundleSnapshots: vi.fn(async () => result([bundle()])),
    listRawEvidence: vi.fn(async () => result([])),
    listRejectedCandidates: vi.fn(async () => result([])),
    listDiagnostics: vi.fn(async () => result([])),
    getRepoWikiSummary: vi.fn(async () => options.repoWikiSummaryResult ?? result(options.repoWikiSummary ?? { activeEntries: 0, staleEntries: 0 })),
    listRepoWikiEntries: vi.fn(async () => options.repoWikiEntriesResult ?? result(options.repoWikiEntries ?? [])),
    saveRepoWikiEntries: vi.fn(async () => result({ savedEntries: 0 })),
    invalidateRepoWikiByFileHash: vi.fn(async () => result({ invalidatedEntries: 0 })),
    approvePendingCandidate: vi.fn(async () => ({ ok: true, value: null, diagnostics: [] })),
    rejectPendingCandidate: vi.fn(async () => ({ ok: true, value: null, diagnostics: [] })),
  } as any
}

function bundle() {
  return {
    id: 'ctx_latest',
    sessionId: 'sess-1',
    requestHash: 'hash',
    createdAt: 1,
    sections: [],
    citations: [],
    diagnostics: [],
    budget: { usedTokens: 0, droppedTokens: 0 },
  }
}

function repoWikiEntry(overrides: Record<string, any> = {}) {
  return {
    id: 'wiki_session',
    projectKey: '/repo',
    kind: 'architecture',
    title: 'Session architecture',
    content: 'Session injects context before model calls.',
    citations: [{ id: 'cit_wiki', type: 'file', ref: 'packages/core/src/session.ts', hash: 'hash_session' }],
    relatedFiles: ['packages/core/src/session.ts'],
    relatedSymbols: ['Session'],
    confidence: 0.91,
    freshness: 'cached',
    generatedBy: { providerProtocol: 'anthropic', modelId: 'claude-sonnet-4' },
    evidenceHash: 'hash',
    status: 'active',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}
