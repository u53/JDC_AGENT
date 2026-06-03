import { z } from 'zod'
import type { ToolContext, ToolHandler, ToolResult } from '../tool-registry.js'
import { ContextCitationSchema, ContextDiagnosticSchema, ContextFactKindSchema, ContextFreshnessSchema, MemoryRecordKindSchema, MemoryScopeSchema } from '../context/schemas.js'
import { openContextStore, type ContextFactQuery, type ContextStore } from '../context/store.js'
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
    const limit = parsed.limit ?? 20
    const query = compactFactQuery({ minConfidence: parsed.minConfidence, citationRef: parsed.citationRef, citationType: parsed.citationType })
    // Accepted durable memory is shared by normalized project root; sessionId is only an IPC cwd resolver.
    const result = await store.listAcceptedProjectFacts(query)
    if (!result.ok) return MemorySearchPayloadSchema.parse({ status: 'unavailable', searchedAt: now(), query: parsed, results: [], diagnostics: result.diagnostics })
    const evidence = parsed.query ? await loadEvidenceLookup(store, now) : { lookup: new Map<string, string[]>(), diagnostics: [] as ContextDiagnostic[] }

    const matches = result.value
      .filter((fact) => fact.scope === 'project' || fact.scope === 'repo' || fact.scope === 'global')
      .filter((fact) => isMemoryFact(fact))
      .filter((fact) => !parsed.scope || fact.scope === parsed.scope)
      .filter((fact) => !parsed.kind || memoryKindFromFact(fact) === parsed.kind)
      .map((fact) => ({ fact, score: memoryQueryScore(fact, parsed.query, evidence.lookup) }))
      .filter((item) => !parsed.query || item.score > 0)
      .sort((a, b) => parsed.query ? b.score - a.score : 0)
      .slice(0, limit)
      .map((item) => memorySearchResultFromFact(item.fact))

    return MemorySearchPayloadSchema.parse({ status: matches.length ? 'available' : 'empty', searchedAt: now(), query: parsed, results: matches, diagnostics: [...result.diagnostics, ...evidence.diagnostics] })
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

function compactFactQuery(query: ContextFactQuery): ContextFactQuery {
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined)) as ContextFactQuery
}

function isMemoryFact(fact: ContextFact): boolean {
  return ['user_preference', 'architecture_decision', 'known_issue', 'project_convention', 'workflow_rule'].includes(fact.kind)
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

function memoryQueryScore(fact: ContextFact, query: string | undefined, lookup: Map<string, string[]>): number {
  if (!query) return 1
  const queryText = normalizeSearchText(query)
  if (!queryText) return 1
  const haystackText = normalizeSearchText(searchableMemoryText(fact, lookup))
  if (!haystackText) return 0
  if (haystackText.includes(queryText)) return 100 + queryText.length
  const queryTokens = searchTokens(queryText)
  if (!queryTokens.length) return 0
  const haystackTokens = new Set(searchTokens(haystackText))
  const matched = queryTokens.filter((token) => haystackTokens.has(token))
  if (!matched.length) return 0
  const coverage = matched.length / queryTokens.length
  const rareBonus = matched.some((token) => token.length >= 5) ? 2 : 0
  return matched.length + coverage * 10 + rareBonus
}

function searchableMemoryText(fact: ContextFact, lookup: Map<string, string[]>): string {
  const parts = [
    fact.id,
    fact.kind,
    memoryKindFromFact(fact),
    fact.scope,
    fact.content,
    fact.sourceProvider,
  ]
  for (const citation of fact.citations) {
    parts.push(citation.id, citation.type, citation.ref, citation.hash ?? '')
    parts.push(...(lookup.get(citation.id.toLowerCase()) ?? []))
    parts.push(...(lookup.get(citation.ref.toLowerCase()) ?? []))
    if (citation.hash) parts.push(...(lookup.get(citation.hash.toLowerCase()) ?? []))
  }
  return parts.join(' ')
}

function normalizeSearchText(text: string): string {
  return text
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function searchTokens(text: string): string[] {
  return normalizeSearchText(text)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
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
