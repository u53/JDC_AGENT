import type { ContextDiagnostic, ContextFact, ContextFactKind, ContextRequest } from './types.js'
import type { ContextStore } from './store.js'

const HIGH_VALUE_KINDS = new Set<ContextFactKind>([
  'workflow_rule',
  'project_convention',
  'architecture_decision',
  'known_issue',
  'current_goal',
  'runtime_error_chain',
  'code_entrypoint',
])

export interface RetrievedContextFact {
  fact: ContextFact
  score: number
  reasons: string[]
}

export interface ContextRetrievalResult {
  facts: RetrievedContextFact[]
  diagnostics: ContextDiagnostic[]
  unavailable?: boolean
}

export interface ContextRetrievalOptions {
  store: Pick<ContextStore, 'listAcceptedProjectFacts'>
  limit?: number
  candidateLimit?: number
  minConfidence?: number
  citationRef?: string
  citationType?: string
  citationTextLookup?: Map<string, string[]>
  now?: () => number
}

export async function retrieveContextFacts(request: ContextRequest, options: ContextRetrievalOptions): Promise<ContextRetrievalResult> {
  const now = options.now ?? Date.now
  const diagnostics: ContextDiagnostic[] = []
  const query = normalizeSearchText([request.userMessage, request.mode].filter(Boolean).join(' '))
  const storeQuery = {
    minConfidence: options.minConfidence ?? 0.01,
    includeStale: true,
    includeExpired: false,
    orderBy: 'updated_desc' as const,
    ...(options.citationRef === undefined ? {} : { citationRef: options.citationRef }),
    ...(options.citationType === undefined ? {} : { citationType: options.citationType }),
    ...(options.candidateLimit === undefined ? {} : { limit: options.candidateLimit }),
  }
  const loaded = await options.store.listAcceptedProjectFacts(storeQuery)
  if (!loaded.ok) return { facts: [], diagnostics: loaded.diagnostics, unavailable: true }

  const scored = loaded.value
    .map((fact) => scoreFact(fact, query, now, options.citationTextLookup))
    .filter((item) => {
      if (item.fact.freshness === 'stale' && !isHighValueStaleFact(item.fact)) {
        diagnostics.push(makeDiagnostic(`Suppressed stale low-value fact ${item.fact.id}.`, now()))
        return false
      }
      if (!query) return true
      return item.score > 0 && (item.reasons.length > 0 || HIGH_VALUE_KINDS.has(item.fact.kind))
    })
    .sort(compareRetrievedFacts)

  const facts = options.limit === undefined ? scored : scored.slice(0, options.limit)
  return { facts, diagnostics: [...loaded.diagnostics, ...diagnostics] }
}

function scoreFact(fact: ContextFact, query: string, now: () => number, citationTextLookup: Map<string, string[]> | undefined): RetrievedContextFact {
  const reasons: string[] = []
  let score = 0

  if (HIGH_VALUE_KINDS.has(fact.kind)) {
    score += 8
    reasons.push('high_value_kind')
  }
  score += Math.max(0, Math.min(1, fact.confidence)) * 10
  if (fact.freshness === 'live') score += 10
  if (fact.freshness === 'recent') score += 6
  if (fact.freshness === 'cached') score += 2
  if (fact.freshness === 'stale') score -= 20

  const ageMs = Math.max(0, now() - fact.updatedAt)
  score += Math.max(0, 5 - ageMs / (7 * 24 * 60 * 60 * 1000))

  if (query) {
    const text = normalizeSearchText(searchableFactText(fact, citationTextLookup))
    const queryTokens = searchTokens(query)
    const textTokens = new Set(searchTokens(text))
    if (text.includes(query)) {
      score += 80 + query.length
      reasons.push('query_match')
    }
    const matched = queryTokens.filter((token) => textTokens.has(token))
    if (matched.length) {
      score += matched.length * 10 + (matched.length / Math.max(queryTokens.length, 1)) * 30
      reasons.push('query_match')
    }
    if (citationMatches(fact, query, queryTokens)) {
      score += 45
      reasons.push('citation_match')
    }
  }

  return { fact, score, reasons: [...new Set(reasons)] }
}

function compareRetrievedFacts(a: RetrievedContextFact, b: RetrievedContextFact): number {
  return b.score - a.score || b.fact.updatedAt - a.fact.updatedAt || b.fact.createdAt - a.fact.createdAt || a.fact.id.localeCompare(b.fact.id)
}

function citationMatches(fact: ContextFact, query: string, queryTokens: string[]): boolean {
  return fact.citations.some((citation) => {
    const ref = normalizeSearchText(citation.ref)
    return ref.includes(query) || queryTokens.some((token) => ref.includes(token))
  })
}

function searchableFactText(fact: ContextFact, citationTextLookup: Map<string, string[]> | undefined): string {
  const parts = [
    fact.id,
    fact.kind,
    fact.scope,
    fact.content,
    fact.sourceProvider,
    ...fact.citations.flatMap((citation) => [citation.id, citation.type, citation.ref, citation.hash ?? '']),
  ]
  if (citationTextLookup) {
    for (const citation of fact.citations) {
      parts.push(...(citationTextLookup.get(citation.id.toLowerCase()) ?? []))
      parts.push(...(citationTextLookup.get(citation.ref.toLowerCase()) ?? []))
      if (citation.hash) parts.push(...(citationTextLookup.get(citation.hash.toLowerCase()) ?? []))
    }
  }
  return parts.join(' ')
}

function isHighValueStaleFact(fact: ContextFact): boolean {
  return fact.kind === 'known_issue' || fact.kind === 'architecture_decision'
}

function makeDiagnostic(message: string, createdAt: number): ContextDiagnostic {
  return {
    id: `diag_context_retriever_${Math.abs(hashText(`${message}:${createdAt}`)).toString(16)}`,
    level: 'info',
    source: 'ContextRetriever',
    message,
    createdAt,
    visibleInPrimaryUi: false,
  }
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
  const normalized = normalizeSearchText(text)
  const tokens = new Set<string>()
  for (const token of normalized.split(' ')) {
    if (token.length >= 2) tokens.add(token)
    if (hasCjk(token)) {
      for (const segment of cjkSegments(token)) {
        for (let size = 2; size <= Math.min(4, segment.length); size += 1) {
          for (let index = 0; index + size <= segment.length; index += 1) {
            tokens.add(segment.slice(index, index + size))
          }
        }
      }
    }
  }
  return [...tokens]
}

function hasCjk(text: string): boolean {
  return /\p{Script=Han}/u.test(text)
}

function cjkSegments(text: string): string[] {
  return text.match(/\p{Script=Han}+/gu) ?? []
}

function hashText(text: string): number {
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0
  }
  return hash
}
