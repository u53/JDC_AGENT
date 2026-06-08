import type { ContextEvidenceRequirement, ContextFreshness } from '../types.js'
import type { RepoWikiEntry } from './types.js'

export interface RetrievedRepoWikiEntry {
  entry: RepoWikiEntry
  score: number
  reasons: string[]
}

export interface RetrieveRepoWikiEntriesInput {
  query: string
  evidenceRequirements?: ContextEvidenceRequirement[]
  entries: RepoWikiEntry[]
  limit?: number
}

export function retrieveRepoWikiEntries(input: RetrieveRepoWikiEntriesInput): RetrievedRepoWikiEntry[] {
  const queryTokens = tokens(input.query)
  const requirements = input.evidenceRequirements ?? []
  const scored = input.entries
    .filter((entry) => entry.status === 'active' && entry.freshness !== 'stale')
    .map((entry) => scoreEntry(entry, queryTokens, requirements))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt || a.entry.id.localeCompare(b.entry.id))
  return typeof input.limit === 'number' ? scored.slice(0, input.limit) : scored
}

function scoreEntry(entry: RepoWikiEntry, queryTokens: string[], requirements: ContextEvidenceRequirement[]): RetrievedRepoWikiEntry {
  const reasons: string[] = []
  let relevanceScore = 0
  const haystack = tokens([
    entry.kind,
    entry.title,
    entry.content,
    ...entry.relatedFiles,
    ...entry.relatedSymbols,
    ...entry.citations.map((citation) => citation.ref),
  ].join(' '))
  const haystackSet = new Set(haystack)
  const matched = queryTokens.filter((token) => haystackSet.has(token))
  if (matched.length) {
    relevanceScore += matched.length * 12
    reasons.push('query_match')
  }

  const files = new Set(entry.relatedFiles.map(normalize))
  const symbols = new Set(entry.relatedSymbols.map(normalize))
  const refs = new Set(entry.citations.map((citation) => normalize(citation.ref)))
  for (const requirement of requirements) {
    if (requirement.query) {
      const requirementMatches = tokens(requirement.query).filter((token) => haystackSet.has(token))
      if (requirementMatches.length) {
        relevanceScore += requirement.priority === 'must' ? requirementMatches.length * 14 : requirementMatches.length * 6
        reasons.push('requirement_query_match')
      }
    }
    if (requirement.relatedFiles.some((file) => files.has(normalize(file)) || refs.has(normalize(file)))) {
      relevanceScore += requirement.priority === 'must' ? 80 : 35
      reasons.push('requirement_file_match')
    }
    if (requirement.relatedSymbols.some((symbol) => symbols.has(normalize(symbol)))) {
      relevanceScore += requirement.priority === 'must' ? 70 : 30
      reasons.push('requirement_symbol_match')
    }
    if (requirement.docRefs.some((doc) => refs.has(normalize(doc)))) {
      relevanceScore += requirement.priority === 'must' ? 50 : 25
      reasons.push('requirement_doc_match')
    }
  }

  if (relevanceScore === 0) return { entry, score: 0, reasons: [] }

  let score = relevanceScore + entry.confidence * 10
  if (entry.confidence > 0) reasons.push('confidence')
  const freshnessScore = scoreFreshness(entry.freshness)
  if (freshnessScore > 0) {
    score += freshnessScore
    reasons.push(`freshness_${entry.freshness}`)
  }
  if (entry.kind === 'architecture' || entry.kind === 'module_boundary') {
    score += 6
    reasons.push('high_value_kind')
  }

  return { entry, score, reasons: [...new Set(reasons)] }
}

function scoreFreshness(freshness: ContextFreshness): number {
  if (freshness === 'live') return 18
  if (freshness === 'recent') return 12
  if (freshness === 'cached') return 6
  return 0
}

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^\p{L}\p{N}_./:-]+/u).map((token) => token.trim()).filter(Boolean)
}

function normalize(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase()
}
