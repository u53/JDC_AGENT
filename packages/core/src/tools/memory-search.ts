import { z } from 'zod'
import type { ToolContext, ToolHandler, ToolResult } from '../tool-registry.js'
import { ContextCitationSchema, ContextDiagnosticSchema, ContextFactKindSchema, ContextFreshnessSchema, MemoryRecordKindSchema, MemoryScopeSchema } from '../context/schemas.js'
import { retrieveContextFacts } from '../context/retriever.js'
import { openContextStore, type ContextStore } from '../context/store.js'
import type { ContextDiagnostic, ContextFact, MemoryRecord, MemoryRecordKind, RawEvidence } from '../context/types.js'

const DurableMemorySearchScopeSchema = z.enum(['global', 'project', 'repo'])

const MemorySearchInputSchema = z.object({
  query: z.string().optional(),
  scope: DurableMemorySearchScopeSchema.optional(),
  kind: MemoryRecordKindSchema.optional(),
  minConfidence: z.number().finite().gt(0).lte(1).optional(),
  citationRef: z.string().optional(),
  citationType: z.string().optional(),
  limit: z.number().int().positive().optional(),
})

export const MemorySearchResultSchema = z.object({
  id: z.string(),
  kind: MemoryRecordKindSchema,
  scope: MemoryScopeSchema,
  content: z.string(),
  citations: z.array(ContextCitationSchema),
  confidence: z.number(),
  freshness: ContextFreshnessSchema,
  sourceProvider: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  expiresAt: z.number().optional(),
})

export type MemorySearchInput = z.infer<typeof MemorySearchInputSchema>
export type MemorySearchResult = {
  id: string
  kind: MemoryRecordKind
  scope: MemoryRecord['scope']
  content: string
  citations: ContextFact['citations']
  confidence: number
  freshness: ContextFact['freshness']
  sourceProvider: string
  createdAt: number
  updatedAt: number
  expiresAt?: number
}
export type MemorySearchPayload = {
  status: 'available' | 'empty' | 'unavailable'
  searchedAt: number
  query: MemorySearchInput
  results: MemorySearchResult[]
  diagnostics: ContextDiagnostic[]
}

export const MemorySearchPayloadSchema: z.ZodType<MemorySearchPayload> = z.object({
  status: z.enum(['available', 'empty', 'unavailable']),
  searchedAt: z.number(),
  query: MemorySearchInputSchema,
  results: z.array(MemorySearchResultSchema),
  diagnostics: z.array(ContextDiagnosticSchema),
})

export interface MemorySearchOptions {
  store?: ContextStore
  cwd?: string
  now?: () => number
}

export async function searchMemoryRecords(input: unknown = {}, options: MemorySearchOptions = {}): Promise<MemorySearchPayload> {
  const parsedInput = MemorySearchInputSchema.safeParse(input)
  const now = options.now ?? Date.now
  if (!parsedInput.success) {
    return MemorySearchPayloadSchema.parse({ status: 'unavailable', searchedAt: now(), query: {}, results: [], diagnostics: [{ id: `diag_memory_search_${now()}`, level: 'warning', source: 'JdcMemorySearch', message: `Memory search rejected invalid input: ${parsedInput.error.message}`, createdAt: now() }] })
  }
  const parsed = parsedInput.data
  try {
    const store = options.store ?? await openContextStore({ cwd: options.cwd })
    const evidence = parsed.query ? await loadEvidenceLookup(store, now) : { lookup: new Map<string, string[]>(), diagnostics: [] as ContextDiagnostic[] }
    const retrieval = await retrieveContextFacts({
      sessionId: 'memory_search',
      cwd: options.cwd ?? process.cwd(),
      userMessage: parsed.query ?? '',
      recentMessages: [],
      mode: 'chat',
      model: 'memory-search',
      runtime: {},
      createdAt: now(),
    }, {
      store,
      minConfidence: parsed.minConfidence,
      citationRef: parsed.citationRef,
      citationType: parsed.citationType,
      citationTextLookup: evidence.lookup,
      now,
    })
    if (retrieval.unavailable) return MemorySearchPayloadSchema.parse({ status: 'unavailable', searchedAt: now(), query: parsed, results: [], diagnostics: [...retrieval.diagnostics, ...evidence.diagnostics] })

    const matches = retrieval.facts
      .map((item) => item.fact)
      .filter((fact) => fact.scope === 'project' || fact.scope === 'repo' || fact.scope === 'global')
      .filter((fact) => isMemoryFact(fact))
      .filter((fact) => matchesMemoryFilters(fact, parsed))
    const limited = parsed.limit === undefined ? matches : matches.slice(0, parsed.limit)
    const results = limited.map(memorySearchResultFromFact)

    return MemorySearchPayloadSchema.parse({ status: results.length ? 'available' : 'empty', searchedAt: now(), query: parsed, results, diagnostics: [...retrieval.diagnostics, ...evidence.diagnostics] })
  } catch (error) {
    return MemorySearchPayloadSchema.parse({ status: 'unavailable', searchedAt: now(), query: parsed, results: [], diagnostics: [{ id: `diag_memory_search_${now()}`, level: 'error', source: 'JdcMemorySearch', message: error instanceof Error ? error.message : String(error), createdAt: now() }] })
  }
}

export function createMemorySearchTool(options: MemorySearchOptions = {}): ToolHandler {
  return {
    definition: {
      name: 'JdcMemorySearch',
      description: [
        'Search accepted durable JDC Context Engine memory facts from the current project store (project/repo/global only).',
        'Use before relying on project conventions, architecture decisions, workflow rules, known issues, or user preferences.',
        'Results are accepted facts only; rejected/skipped/no-op harvest attempts are not memory.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          scope: { type: 'string', enum: DurableMemorySearchScopeSchema.options },
          kind: { type: 'string', enum: ['user_preference', 'project_convention', 'architecture_decision', 'known_issue', 'workflow_hint'] },
          minConfidence: { type: 'number' },
          citationRef: { type: 'string' },
          citationType: { type: 'string' },
          limit: { type: 'number' },
        },
      },
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const payload = await searchMemoryRecords(input, { ...options, cwd: context.cwd })
      return { content: JSON.stringify(payload, null, 2), isError: payload.status === 'unavailable' }
    },
  }
}

export function memorySearchResultFromFact(fact: ContextFact): MemorySearchResult {
  return {
    id: fact.id,
    kind: memoryKindFromFact(fact),
    scope: fact.scope === 'turn' ? 'session' : fact.scope,
    content: fact.content,
    citations: fact.citations,
    confidence: fact.confidence,
    freshness: fact.freshness,
    sourceProvider: fact.sourceProvider,
    createdAt: fact.createdAt,
    updatedAt: fact.updatedAt,
    expiresAt: fact.expiresAt,
  }
}

export function memoryRecordFromFact(fact: ContextFact): MemoryRecord {
  return {
    id: fact.id,
    kind: memoryKindFromFact(fact),
    scope: fact.scope === 'turn' ? 'session' : fact.scope,
    content: fact.content,
    citations: fact.citations,
    confidence: fact.confidence,
    createdAt: fact.createdAt,
    updatedAt: fact.updatedAt,
    expiresAt: fact.expiresAt,
  }
}

function isMemoryFact(fact: ContextFact): boolean {
  return ['user_preference', 'architecture_decision', 'known_issue', 'project_convention', 'workflow_rule'].includes(fact.kind)
}

function matchesMemoryFilters(fact: ContextFact, parsed: MemorySearchInput): boolean {
  if (parsed.citationRef && !fact.citations.some((citation) => citation.ref === parsed.citationRef)) return false
  if (parsed.citationType && !fact.citations.some((citation) => citation.type === parsed.citationType)) return false
  if (parsed.scope && fact.scope !== parsed.scope) return false
  if (parsed.kind && memoryKindFromFact(fact) !== parsed.kind) return false
  if (parsed.minConfidence !== undefined && fact.confidence < parsed.minConfidence) return false
  return true
}

async function loadEvidenceLookup(store: ContextStore, now: () => number): Promise<{ lookup: Map<string, string[]>; diagnostics: ContextDiagnostic[] }> {
  const result = await store.listRawEvidence()
  if (!result.ok) {
    return {
      lookup: new Map(),
      diagnostics: result.diagnostics.length
        ? result.diagnostics
        : [{ id: `diag_memory_search_evidence_${now()}`, level: 'warning', source: 'JdcMemorySearch', message: 'Memory search could not load citation evidence; searching accepted fact text only.', createdAt: now() }],
    }
  }
  return { lookup: evidenceLookup(result.value), diagnostics: result.diagnostics }
}

function evidenceLookup(evidence: RawEvidence[]): Map<string, string[]> {
  const lookup = new Map<string, string[]>()
  for (const item of evidence) {
    const keys = evidenceKeys(item)
    for (const key of keys) {
      const normalized = key.toLowerCase()
      const values = lookup.get(normalized) ?? []
      values.push(item.content, item.sourceProvider, item.kind)
      lookup.set(normalized, values)
    }
  }
  return lookup
}

function evidenceKeys(evidence: RawEvidence): string[] {
  const keys = [evidence.id, evidence.hash]
  const metadata = evidence.metadata ?? {}
  for (const key of ['messageId', 'toolUseId', 'taskId', 'file', 'ref']) {
    const value = metadata[key]
    if (typeof value === 'string' && value) keys.push(value)
  }
  return keys
}

function memoryKindFromFact(fact: ContextFact): MemoryRecordKind {
  switch (fact.kind) {
    case 'user_preference':
      return 'user_preference'
    case 'architecture_decision':
      return 'architecture_decision'
    case 'known_issue':
      return 'known_issue'
    case 'project_convention':
      return 'project_convention'
    case 'workflow_rule':
    default:
      return 'workflow_hint'
  }
}

export function contextFactKindFromMemoryKind(kind: MemoryRecordKind): z.infer<typeof ContextFactKindSchema> {
  switch (kind) {
    case 'user_preference':
      return 'user_preference'
    case 'architecture_decision':
      return 'architecture_decision'
    case 'known_issue':
      return 'known_issue'
    case 'project_convention':
      return 'project_convention'
    case 'workflow_hint':
      return 'workflow_rule'
  }
}
