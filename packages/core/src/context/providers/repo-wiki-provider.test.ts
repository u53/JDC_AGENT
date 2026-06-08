import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { collectRepoWikiContext } from '../repo-wiki/provider.js'
import { createContextScheduler } from '../scheduler.js'
import { IndexStore } from '../../context-engine/graph/store.js'
import type { FileIndex } from '../../context-engine/types.js'
import type { ContextRequest } from '../types.js'
import type { ContextStore } from '../store.js'

function request(overrides: Partial<ContextRequest> = {}): ContextRequest {
  return {
    sessionId: 'session_1',
    cwd: '/repo',
    userMessage: 'Session 怎么注入上下文',
    recentMessages: [],
    mode: 'code_edit',
    model: 'claude-sonnet-4',
    runtime: {},
    createdAt: 1_700_000_000_000,
    evidenceRequirements: [{
      id: 'req_1',
      kind: 'relevant_code',
      reason: 'Need code evidence',
      query: 'Session context',
      priority: 'must',
      relatedFiles: ['packages/core/src/session.ts'],
      relatedSymbols: ['Session'],
      docRefs: [],
      languageHints: ['zh'],
    }],
    ...overrides,
  }
}

function storeWithEntries(entries: any[]): Pick<ContextStore, 'listRepoWikiEntries' | 'getRepoWikiSummary' | 'saveDiagnostic' | 'saveRepoWikiEntries'> {
  return {
    listRepoWikiEntries: vi.fn(async () => ({ ok: true, value: entries, diagnostics: [] })),
    getRepoWikiSummary: vi.fn(async () => ({ ok: true, value: { activeEntries: entries.length, staleEntries: 0, lastGeneratedAt: 1, lastModelId: 'claude-sonnet-4' }, diagnostics: [] })),
    saveDiagnostic: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
    saveRepoWikiEntries: vi.fn(async () => ({ ok: true, value: { savedEntries: 0 }, diagnostics: [] })),
  } as any
}

function indexedFile(filePath: string, content: string): FileIndex {
  return {
    filePath,
    language: 'ts',
    hash: createHash('sha1').update(content).digest('hex'),
    symbols: [{
      id: `${filePath}#Session@1`,
      name: 'Session',
      kind: 'class',
      filePath,
      line: 1,
      column: 14,
      startLine: 1,
      endLine: 1,
      signature: 'export class Session {}',
    }],
    references: [],
    imports: [],
  }
}

describe('collectRepoWikiContext', () => {
  it('renders matching wiki entries as a repo_wiki context section', async () => {
    const result = await collectRepoWikiContext(request(), {
      store: storeWithEntries([{
        id: 'wiki_session',
        projectKey: '/repo',
        kind: 'architecture',
        title: 'Session context injection',
        content: 'Session injects context before model calls.',
        citations: [{ id: 'cit', type: 'file', ref: 'packages/core/src/session.ts', hash: 'hash_session' }],
        relatedFiles: ['packages/core/src/session.ts'],
        relatedSymbols: ['Session'],
        confidence: 0.91,
        freshness: 'cached',
        generatedBy: { providerProtocol: 'anthropic', modelId: 'claude-sonnet-4' },
        evidenceHash: 'hash',
        status: 'active',
        createdAt: 1,
        updatedAt: 1,
      }]),
    })

    expect(result.sections).toEqual([
      expect.objectContaining({
        kind: 'repo_wiki',
        title: 'Repo Wiki',
        sourceProvider: 'RepoWikiProvider',
        citations: [expect.objectContaining({ ref: 'packages/core/src/session.ts' })],
      }),
    ])
    expect(result.health).toMatchObject({ id: 'repo_wiki', status: 'cached' })
  })

  it('queues refresh when stored repo wiki has stale entries even if active entries render', async () => {
    const activeEntry = {
      id: 'wiki_session',
      projectKey: '/repo',
      kind: 'architecture',
      title: 'Session context injection',
      content: 'Session injects context before model calls.',
      citations: [{ id: 'cit', type: 'file', ref: 'packages/core/src/session.ts', hash: 'hash_session' }],
      relatedFiles: ['packages/core/src/session.ts'],
      relatedSymbols: ['Session'],
      confidence: 0.91,
      freshness: 'cached',
      generatedBy: { providerProtocol: 'anthropic', modelId: 'claude-sonnet-4' },
      evidenceHash: 'hash',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    }
    const scheduler = { enqueueBackground: vi.fn(() => ({ accepted: true, promise: Promise.resolve() })), recorder: { record: vi.fn() } }
    const result = await collectRepoWikiContext(request(), {
      store: {
        ...storeWithEntries([activeEntry]),
        getRepoWikiSummary: vi.fn(async () => ({ ok: true, value: { activeEntries: 1, staleEntries: 1, lastGeneratedAt: 1, lastModelId: 'claude-sonnet-4' }, diagnostics: [] })),
      } as any,
      scheduler: scheduler as any,
      getContextEngine: () => ({ isIndexed: () => true, getStore: () => ({ allFiles: () => [] }) }) as any,
      modelClient: { completeRepoWiki: vi.fn(async () => '{"schemaVersion":1,"action":"skip","reason":"insufficient_evidence","sections":[]}') },
      modelConfig: { model: 'claude-sonnet-4', maxTokens: 8_000 },
    })

    expect(result.sections).toHaveLength(1)
    expect(result.health).toMatchObject({ id: 'repo_wiki', status: 'cached' })
    expect(scheduler.enqueueBackground).toHaveBeenCalledTimes(1)
  })

  it('does not render unrelated active repo wiki entries', async () => {
    const result = await collectRepoWikiContext(request(), {
      store: storeWithEntries([{
        id: 'wiki_billing',
        projectKey: '/repo',
        kind: 'architecture',
        title: 'Billing pipeline',
        content: 'Invoices are reconciled by nightly jobs.',
        citations: [{ id: 'cit_billing', type: 'file', ref: 'packages/billing/src/invoice.ts', hash: 'hash_billing' }],
        relatedFiles: ['packages/billing/src/invoice.ts'],
        relatedSymbols: ['InvoiceJob'],
        confidence: 0.99,
        freshness: 'live',
        generatedBy: { providerProtocol: 'anthropic', modelId: 'claude-sonnet-4' },
        evidenceHash: 'hash_billing',
        status: 'active',
        createdAt: 1,
        updatedAt: 2,
      }]),
    })

    expect(result.sections).toEqual([])
    expect(result.health).toMatchObject({ id: 'repo_wiki', status: 'enabled' })
  })

  it('queues generation when no active entries exist and foreground returns quickly', async () => {
    const scheduler = { enqueueBackground: vi.fn(() => ({ accepted: true, promise: Promise.resolve() })), recorder: { record: vi.fn() } }
    const result = await collectRepoWikiContext(request(), {
      store: storeWithEntries([]),
      scheduler: scheduler as any,
      getContextEngine: () => ({ isIndexed: () => true, getStore: () => ({ allFiles: () => [] }) }) as any,
      modelClient: { completeRepoWiki: vi.fn(async () => '{"schemaVersion":1,"action":"skip","reason":"insufficient_evidence","sections":[]}') },
      modelConfig: { model: 'claude-sonnet-4', maxTokens: 8_000 },
      providerProtocol: 'anthropic',
    })

    expect(result.sections).toEqual([])
    expect(result.health).toMatchObject({ id: 'repo_wiki', status: 'indexing' })
    expect(scheduler.enqueueBackground).toHaveBeenCalledWith('/repo', 'repo_wiki_generate', expect.any(Function), { minIntervalMs: 300000 })
  })

  it('does not queue generation when store reads fail', async () => {
    const scheduler = { enqueueBackground: vi.fn(), recorder: { record: vi.fn() } }
    const diag = { id: 'diag_store', level: 'error' as const, source: 'Store', message: 'store unavailable', createdAt: 1 }
    const result = await collectRepoWikiContext(request(), {
      store: {
        listRepoWikiEntries: vi.fn(async () => ({ ok: false, value: [], diagnostics: [diag] })),
        getRepoWikiSummary: vi.fn(async () => ({ ok: false, value: { activeEntries: 0, staleEntries: 0 }, diagnostics: [diag] })),
        saveDiagnostic: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
        saveRepoWikiEntries: vi.fn(async () => ({ ok: true, value: { savedEntries: 0 }, diagnostics: [] })),
      } as any,
      scheduler: scheduler as any,
      modelClient: { completeRepoWiki: vi.fn() },
      modelConfig: { model: 'claude-sonnet-4', maxTokens: 8_000 },
    })

    expect(result.sections).toEqual([])
    expect(result.diagnostics).toContain(diag)
    expect(result.health).toMatchObject({ id: 'repo_wiki', status: 'failed' })
    expect(scheduler.enqueueBackground).not.toHaveBeenCalled()
  })

  it('does not enqueue repo wiki generation until the code index is ready', async () => {
    const scheduler = { enqueueBackground: vi.fn(() => ({ accepted: true, promise: Promise.resolve() })), recorder: { record: vi.fn() } }
    const result = await collectRepoWikiContext(request(), {
      store: storeWithEntries([]),
      scheduler: scheduler as any,
      getContextEngine: () => ({ isIndexed: () => false, getStore: () => ({ allFiles: () => [] }) }) as any,
      modelClient: { completeRepoWiki: vi.fn() },
      modelConfig: { model: 'claude-sonnet-4', maxTokens: 8_000 },
    })

    expect(result.health).toMatchObject({ id: 'repo_wiki', status: 'not_indexed' })
    expect(scheduler.enqueueBackground).not.toHaveBeenCalled()
  })

  it('defers heavy repo wiki generation work until after the foreground turn returns', async () => {
    let heavyWorkStarted = false
    const scheduler = createContextScheduler()
    const result = await collectRepoWikiContext(request(), {
      store: storeWithEntries([]),
      scheduler: scheduler as any,
      getContextEngine: () => ({ isIndexed: () => true, getStore: () => {
        heavyWorkStarted = true
        return { allFiles: () => [] }
      } }) as any,
      modelClient: { completeRepoWiki: vi.fn(async () => '{"schemaVersion":1,"action":"skip","reason":"insufficient_evidence","sections":[]}') },
      modelConfig: { model: 'claude-sonnet-4', maxTokens: 8_000 },
    })

    expect(result.health).toMatchObject({ id: 'repo_wiki', status: 'indexing' })
    expect(heavyWorkStarted).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(heavyWorkStarted).toBe(true)
  })

  it('normalizes equivalent project paths for repo wiki generation dedupe and model cache user', async () => {
    let generationTask: ((signal: AbortSignal) => Promise<void>) | undefined
    let resolveGeneration!: () => void
    const cacheUsers: string[] = []
    const scheduler = {
      enqueueBackground: vi.fn((_projectKey: string, _name: string, task: (signal: AbortSignal) => Promise<void>) => {
        generationTask = task
        return { accepted: true, promise: new Promise<void>((resolve) => { resolveGeneration = resolve }) }
      }),
      recorder: { record: vi.fn() },
    }
    const modelClient = { completeRepoWiki: vi.fn(async (modelRequest: { cacheUser?: string }) => {
      cacheUsers.push(modelRequest.cacheUser ?? '')
      return '{"schemaVersion":1,"action":"skip","reason":"insufficient_evidence","sections":[]}'
    }) }
    const options = {
      store: storeWithEntries([]),
      scheduler: scheduler as any,
      getContextEngine: () => ({ isIndexed: () => true, getStore: () => ({ allFiles: () => [] }) }) as any,
      modelClient,
      modelConfig: { model: 'claude-sonnet-4', maxTokens: 8_000 },
    }

    await collectRepoWikiContext(request({ cwd: '/repo' }), options)
    await collectRepoWikiContext(request({ cwd: '/repo/.' }), options)
    expect(scheduler.enqueueBackground).toHaveBeenCalledTimes(1)
    expect(scheduler.enqueueBackground).toHaveBeenCalledWith('/repo', 'repo_wiki_generate', expect.any(Function), { minIntervalMs: 300000 })

    await generationTask?.(new AbortController().signal)
    resolveGeneration()
    await Promise.resolve()
    await collectRepoWikiContext(request({ cwd: '/repo/.' }), options)
    expect(scheduler.enqueueBackground).toHaveBeenCalledTimes(2)
    await generationTask?.(new AbortController().signal)
    expect(new Set(cacheUsers).size).toBe(1)
  })

  it('reports repo wiki persistence failures and saves diagnostics best-effort', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'jdc-repo-wiki-provider-'))
    mkdirSync(path.join(cwd, 'packages/core/src'), { recursive: true })
    const fileContent = 'export class Session {}\n'
    writeFileSync(path.join(cwd, 'packages/core/src/session.ts'), fileContent)
    const indexStore = new IndexStore()
    indexStore.upsertFile(indexedFile('packages/core/src/session.ts', fileContent))
    const savedDiagnostics: string[] = []
    let generationTask: ((signal: AbortSignal) => Promise<void>) | undefined
    const scheduler = {
      enqueueBackground: vi.fn((_projectKey: string, _name: string, task: (signal: AbortSignal) => Promise<void>) => {
        generationTask = task
        return { accepted: true, promise: Promise.resolve() }
      }),
      recorder: { record: vi.fn() },
    }
    const store = {
      ...storeWithEntries([]),
      saveRepoWikiEntries: vi.fn(async () => ({ ok: false, value: { savedEntries: 0 }, diagnostics: [{ id: 'diag_save', level: 'error' as const, source: 'Store', message: 'save failed', createdAt: 1 }] })),
      saveDiagnostic: vi.fn(async (diag: { id: string }) => {
        savedDiagnostics.push(diag.id)
        if (diag.id === 'diag_save') throw new Error('diagnostic write failed')
        return { ok: false, value: undefined, diagnostics: [] }
      }),
    } as any
    const result = await collectRepoWikiContext(request({ cwd }), {
      store,
      scheduler: scheduler as any,
      getContextEngine: () => ({ isIndexed: () => true, getStore: () => indexStore }) as any,
      modelClient: { completeRepoWiki: vi.fn(async (modelRequest) => {
        const packet = modelRequest.evidence.packets.find((item: { ref: string }) => item.ref === 'packages/core/src/session.ts')
        return JSON.stringify({
          schemaVersion: 1,
          action: 'save',
          sections: [{ kind: 'architecture', title: 'Session architecture', content: 'Session lives in session.ts.', citationPacketIds: [packet?.id], relatedFiles: ['packages/core/src/session.ts'], relatedSymbols: ['Session'], confidence: 0.8 }],
        })
      }) },
      modelConfig: { model: 'claude-sonnet-4', maxTokens: 8_000 },
    })

    expect(result.health).toMatchObject({ id: 'repo_wiki', status: 'indexing' })
    await expect(generationTask?.(new AbortController().signal)).resolves.toBeUndefined()
    expect(savedDiagnostics).toContain('diag_save')
    expect(store.saveDiagnostic).toHaveBeenCalled()
  })
})
