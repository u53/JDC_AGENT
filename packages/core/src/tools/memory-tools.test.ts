import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { closeContextStore, openContextStore } from '../context/store.js'
import { MemorySearchPayloadSchema, createMemorySearchTool, searchMemoryRecords } from './memory-search.js'
import { MemoryWritePayloadSchema, createMemoryWriteTool, writeMemoryRecord } from './memory-write.js'
import type { ContextDiagnostic, ContextFact } from '../context/types.js'

const citation = { id: 'cit_msg_1', type: 'message' as const, ref: 'msg_1' }
const diagnostic: ContextDiagnostic = {
  id: 'diag_1',
  level: 'warning',
  source: 'MemoryWrite',
  message: 'durable context requires at least one citation',
  createdAt: 1_000,
}

describe('JDC Context Engine memory tools', () => {
  it('describes durable project-memory search and write contracts to the model', () => {
    const writeTool = createMemoryWriteTool()
    const searchTool = createMemorySearchTool()

    expect(writeTool.definition.description).toBe([
      'Write an accepted, citation-backed JDC Context Engine memory fact into the current project store.',
      'Use only when the user explicitly asks to remember/save a durable project rule, workflow convention, architecture decision, known issue, or preference.',
      'Default scope is project for project conventions and repo-specific workflow rules.',
      'Do not write greetings, guesses, uncited summaries, secrets, raw thinking/reasoning, or transient one-turn state.',
      'Requires citations with id/type/ref, optional line/range/timestamp/hash, or a citation string shortcut. Data persists under <project>/.jdcagnet/context-engine/context.db.',
    ].join(' '))
    expect(searchTool.definition.description).toBe([
      'Search accepted durable JDC Context Engine memory facts from the current project store (project/repo/global only).',
      'Use before relying on project conventions, architecture decisions, workflow rules, known issues, or user preferences.',
      'Results are accepted facts only; rejected/skipped/no-op harvest attempts are not memory.',
    ].join(' '))

    const searchInputSchema = searchTool.definition.inputSchema as any
    const writeInputSchema = writeTool.definition.inputSchema as any

    expect(searchInputSchema.properties.scope.enum).toEqual(['global', 'project', 'repo'])
    expect(writeInputSchema.required).not.toContain('scope')
    expect(writeInputSchema.properties.scope.default).toBe('project')
    expect(writeInputSchema.properties.citations.oneOf).toEqual([
      expect.objectContaining({ type: 'array' }),
      expect.objectContaining({ type: 'string' }),
    ])
  })

  it('searches accepted durable project memory by query, scope, kind, and confidence', async () => {
    const store = makeStore({ facts: [fact({ id: 'memory_fact', content: 'Use test-first changes for JDC Context Engine tools.' })] })

    const payload = await searchMemoryRecords({ query: 'test-first', scope: 'project', kind: 'workflow_hint', minConfidence: 0.8 }, { store })

    expect(MemorySearchPayloadSchema.parse(payload).results).toHaveLength(1)
    expect(payload.results[0]).toMatchObject({
      id: 'memory_fact',
      kind: 'workflow_hint',
      scope: 'project',
      confidence: 0.92,
      freshness: 'recent',
      citations: [citation],
    })
    expect(store.listAcceptedProjectFacts).toHaveBeenCalledWith(expect.objectContaining({
      minConfidence: 0.8,
      includeStale: true,
      includeExpired: false,
      orderBy: 'updated_desc',
    }))
    expect(store.queryFacts).not.toHaveBeenCalled()
  })

  it('treats sessionId as IPC provenance and does not filter accepted durable memory by session', async () => {
    const store = makeStore({
      facts: [
        fact({ id: 'session_a_memory', sessionId: 'session_a', content: 'Project memory belongs to the normalized cwd.' }),
      ],
    })

    const payload = await searchMemoryRecords({ sessionId: 'session_b', query: 'normalized cwd' } as any, { store })

    expect(payload.results.map((item) => item.id)).toEqual(['session_a_memory'])
    expect(store.listAcceptedProjectFacts).toHaveBeenCalledWith(expect.objectContaining({
      minConfidence: 0.01,
      includeStale: true,
      includeExpired: false,
      orderBy: 'updated_desc',
    }))
  })

  it('passes citation filters to accepted project fact search', async () => {
    const store = makeStore({
      facts: [
        fact({ id: 'non_matching_citation', citations: [{ id: 'cit_msg_1', type: 'message', ref: 'msg_1' }] }),
        fact({ id: 'matching_citation', citations: [{ id: 'cit_msg_2', type: 'message', ref: 'msg_2' }] }),
      ],
    })

    const payload = await searchMemoryRecords({ citationRef: 'msg_2', citationType: 'message' }, { store })

    expect(payload.results.map((item) => item.id)).toEqual(['matching_citation'])
    expect(store.listAcceptedProjectFacts).toHaveBeenCalledWith(expect.objectContaining({ citationRef: 'msg_2', citationType: 'message' }))
  })

  it('rejects unsupported session scope searches before touching the store', async () => {
    const store = makeStore()
    const payload = await searchMemoryRecords({ scope: 'session' }, { store, now: () => 4_000 })

    expect(payload.status).toBe('unavailable')
    expect(payload.diagnostics[0]?.message).toContain('scope')
    expect(store.listAcceptedProjectFacts).not.toHaveBeenCalled()
  })

  it('applies memory search limit after query, scope, and kind filters', async () => {
    const store = makeStore({
      facts: [
        fact({ id: 'newer_nonmatching_1', content: 'Unrelated durable fact.', updatedAt: 30 }),
        fact({ id: 'newer_nonmatching_2', content: 'Another unrelated durable fact.', updatedAt: 20 }),
        fact({ id: 'older_matching', content: 'Use test-first changes for JDC Context Engine tools.', updatedAt: 10 }),
      ],
    })

    const payload = await searchMemoryRecords({ query: 'test-first', scope: 'project', kind: 'workflow_hint', limit: 1 }, { store })

    expect(payload.results.map((item) => item.id)).toEqual(['older_matching'])
    expect(store.listAcceptedProjectFacts).toHaveBeenCalledWith(expect.objectContaining({
      minConfidence: 0.01,
      includeStale: true,
      includeExpired: false,
      orderBy: 'updated_desc',
    }))
  })

  it('uses retrieval ranking so an old relevant workflow beats newer irrelevant facts', async () => {
    const store = makeStore({
      facts: [
        ...Array.from({ length: 30 }, (_, index) => fact({
          id: `recent_irrelevant_${index}`,
          kind: 'user_preference',
          content: `Recent unrelated memory ${index}`,
          updatedAt: 10_000 + index,
        })),
        fact({
          id: 'old_release_workflow',
          content: 'JDCAGNET 发布流程：bump version，commit，tag，然后 push tag 触发 release workflow。',
          updatedAt: 1,
        }),
      ],
    })

    const payload = await searchMemoryRecords({ query: '发布流程', limit: 3 }, { store, now: () => 20_000 })

    expect(payload.status).toBe('available')
    expect(payload.results.map((item) => item.id)).toEqual(['old_release_workflow'])
    expect(store.listAcceptedProjectFacts).toHaveBeenCalledWith(expect.objectContaining({
      minConfidence: 0.01,
      includeStale: true,
      includeExpired: false,
      orderBy: 'updated_desc',
    }))
  })

  it('does not impose a default memory search result limit', async () => {
    const store = makeStore({
      facts: Array.from({ length: 25 }, (_, index) => fact({
        id: `workflow_${index}`,
        kind: 'workflow_rule',
        content: `Workflow fact ${index}`,
        updatedAt: index,
      })),
    })

    const payload = await searchMemoryRecords({}, { store, now: () => 20_000 })

    expect(payload.results).toHaveLength(25)
    expect(store.listAcceptedProjectFacts).toHaveBeenCalledWith(expect.not.objectContaining({
      limit: expect.any(Number),
    }))
  })

  it('rejects memory writes without citations before touching the store', async () => {
    const store = makeStore()
    const payload = await writeMemoryRecord({ kind: 'workflow_hint', scope: 'project', content: 'Uncited AI summary', citations: [], confidence: 0.9 }, { store, now: () => 2_000 })

    expect(MemoryWritePayloadSchema.parse(payload).status).toBe('rejected')
    expect(payload.diagnostics[0]?.message).toContain('citation')
    expect(store.saveFact).not.toHaveBeenCalled()
  })

  it('rejects raw thinking or reasoning data before touching the store', async () => {
    const store = makeStore()
    const payload = await writeMemoryRecord({
      kind: 'workflow_hint',
      scope: 'project',
      content: 'raw thinking: private chain of thought',
      citations: [citation],
      confidence: 0.9,
    }, { store, now: () => 2_000 })

    expect(payload.status).toBe('rejected')
    expect(payload.diagnostics[0]?.message).toContain('raw thinking')
    expect(store.saveFact).not.toHaveBeenCalled()
  })

  it('writes cited memory through context fact validation and exposes store rejection diagnostics', async () => {
    const acceptedStore = makeStore()
    const accepted = await writeMemoryRecord({
      kind: 'workflow_hint',
      scope: 'project',
      content: 'Run context validation before storing memory.',
      citations: [citation],
      confidence: 0.9,
    }, { store: acceptedStore, now: () => 2_000 })

    expect(accepted.status).toBe('accepted')
    expect(accepted.record).toMatchObject({ kind: 'workflow_hint', scope: 'project', citations: [citation], confidence: 0.9 })
    expect(acceptedStore.saveFact).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'workflow_rule',
      scope: 'project',
      content: 'Run context validation before storing memory.',
      citations: [citation],
      sourceProvider: 'JdcMemoryWrite',
    }))

    const rejectedStore = makeStore({ saveFactResult: { ok: false, value: undefined, diagnostics: [diagnostic] } })
    const rejected = await writeMemoryRecord({
      kind: 'workflow_hint',
      scope: 'project',
      content: 'Still must be cited.',
      citations: [citation],
      confidence: 0.9,
    }, { store: rejectedStore, now: () => 2_000 })

    expect(rejected.status).toBe('rejected')
    expect(rejected.diagnostics).toEqual([diagnostic])
  })

  it('defaults writes to project scope and normalizes model citation and confidence shortcuts', async () => {
    const store = makeStore()

    const payload = await writeMemoryRecord({
      kind: 'workflow_hint',
      content: 'Run pnpm build before release.',
      citation: 'User explicitly asked to remember this project convention.',
      confidence: '0.88',
    }, { store, now: () => 3_000 })

    expect(payload.status).toBe('accepted')
    expect(payload.record).toMatchObject({ scope: 'project', confidence: 0.88, citations: [expect.objectContaining({ type: 'message' })] })
    expect(store.saveRawEvidence).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'message',
      sourceProvider: 'JdcMemoryWrite',
      content: 'User explicitly asked to remember this project convention.',
    }))
    expect(store.saveFact).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'project',
      confidence: 0.88,
      citations: [expect.objectContaining({ type: 'message' })],
    }))
  })

  it('finds a written memory by the original citation evidence even when fact content does not repeat the query', async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'jdc-memory-search-'))
    try {
      const store = await openContextStore({ cwd, now: () => 10_000 })
      const write = await writeMemoryRecord({
        kind: 'architecture_decision',
        content: 'JDC Context Engine uses a per-process singleton and registers code tools through context-engine-tools.ts.',
        citation: '用户问：JdcMemorySearch 这个不是说写一条项目记忆然后立刻搜出来验证吗？',
        confidence: 0.95,
      }, { store, cwd, now: () => 10_000 })
      expect(write.status).toBe('accepted')

      const search = await searchMemoryRecords({ query: 'JdcMemorySearch', limit: 5 }, { store, cwd, now: () => 10_001 })

      expect(search.status).toBe('available')
      expect(search.results.map((item) => item.id)).toContain(write.record!.id)
    } finally {
      await closeContextStore({ cwd })
    }
  })

  it('tool execution returns JSON and never throws on store failures', async () => {
    const store = makeStore({ listAcceptedProjectFactsResult: { ok: false, value: [], diagnostics: [diagnostic] } })
    const searchTool = createMemorySearchTool({ store })
    const writeTool = createMemoryWriteTool({ store, now: () => 2_000 })

    const search = await searchTool.execute({ query: 'anything' }, { cwd: '/repo', turnIndex: 0 } as any)
    expect(JSON.parse(search.content).status).toBe('unavailable')

    const write = await writeTool.execute({ kind: 'workflow_hint', scope: 'project', content: 'x', citations: [], confidence: 0.9 }, { cwd: '/repo', turnIndex: 0 } as any)
    expect(JSON.parse(write.content).status).toBe('rejected')
  })
})

function makeStore(options: Record<string, any> = {}) {
  const result = <T>(value: T) => ({ ok: true, value, diagnostics: [] })
  return {
    saveRawEvidence: vi.fn(async () => result(undefined)),
    saveFact: vi.fn(async () => options.saveFactResult ?? result(undefined)),
    saveHarvestJob: vi.fn(async () => result(undefined)),
    updateHarvestJob: vi.fn(async () => result(undefined)),
    listHarvestJobs: vi.fn(async () => result([])),
    rejectCandidate: vi.fn(async () => result(null)),
    saveBundleSnapshot: vi.fn(async () => result(undefined)),
    saveDiagnostic: vi.fn(async () => result(undefined)),
    queryFacts: vi.fn(async () => result(options.facts ?? [])),
    listAcceptedProjectFacts: vi.fn(async (query: { minConfidence?: number; citationRef?: string; citationType?: string; limit?: number } = {}) => {
      if (options.listAcceptedProjectFactsResult) return options.listAcceptedProjectFactsResult
      let facts = (options.facts ?? []).filter((fact: ContextFact) => fact.scope === 'project' || fact.scope === 'repo' || fact.scope === 'global')
      if (query.minConfidence !== undefined) facts = facts.filter((fact: ContextFact) => fact.confidence >= query.minConfidence!)
      if (query.citationRef) facts = facts.filter((fact: ContextFact) => fact.citations.some((citation) => citation.ref === query.citationRef))
      if (query.citationType) facts = facts.filter((fact: ContextFact) => fact.citations.some((citation) => citation.type === query.citationType))
      if (query.limit !== undefined) facts = facts.slice(0, query.limit)
      return result(facts)
    }),
    listAdvancedDiagnostics: vi.fn(async () => result({ rejected: [], diagnostics: [], harvestJobs: [] })),
    invalidateByFileHash: vi.fn(async () => result({ invalidatedFacts: 0 })),
    enforceQuotas: vi.fn(async () => result({ deletedFacts: 0, deletedBundles: 0, deletedRawEvidence: 0, deletedRejectedCandidates: 0 })),
    getSchemaInfo: vi.fn(async () => result({ version: 1, dbPath: '/tmp/context.db' })),
    listBundleSnapshots: vi.fn(async () => result([])),
    listRawEvidence: vi.fn(async () => result([])),
    listRejectedCandidates: vi.fn(async () => result([])),
    listDiagnostics: vi.fn(async () => result([])),
    approvePendingCandidate: vi.fn(async () => ({ ok: true, value: null, diagnostics: [] })),
    rejectPendingCandidate: vi.fn(async () => ({ ok: true, value: null, diagnostics: [] })),
  }
}

function fact(overrides: Partial<ContextFact> = {}): ContextFact {
  return {
    id: 'memory_1',
    kind: 'workflow_rule',
    scope: 'project',
    content: 'Run context validation before storing memory.',
    citations: [citation],
    confidence: 0.92,
    freshness: 'recent',
    sourceProvider: 'JdcMemoryWrite',
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  }
}
