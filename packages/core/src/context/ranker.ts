import { createHash } from 'node:crypto'
import type { ContextSection } from './types.js'

const KIND_WEIGHT: Record<ContextSection['kind'], number> = {
  agent_contract: 1_400,
  user_intent: 1_300,
  runtime_state: 900,
  ide_state: 800,
  conversation_state: 700,
  relevant_code: 650,
  git_state: 600,
  repo_wiki: 550,
  project_profile: 500,
  code_map: 450,
  memory: 350,
  diagnostics: 100,
}

const KIND_AUTHORITY_TIER: Record<ContextSection['kind'], number> = {
  agent_contract: 12,
  user_intent: 11,
  runtime_state: 9,
  ide_state: 9,
  conversation_state: 8,
  git_state: 7,
  project_profile: 7,
  diagnostics: 7,
  memory: 6,
  relevant_code: 5,
  repo_wiki: 4,
  code_map: 3,
}

const FRESHNESS_WEIGHT: Record<ContextSection['freshness'], number> = {
  live: 400,
  recent: 250,
  cached: 100,
  stale: 0,
}

export interface RankedContextSection extends ContextSection {
  rankScore: number
}

export function rankContextSections(sections: ContextSection[]): ContextSection[] {
  const ranked = sections
    .map((section, index) => ({ ...section, authorityTier: KIND_AUTHORITY_TIER[section.kind], rankScore: scoreSection(section), index }))
    .sort((a, b) => b.authorityTier - a.authorityTier || b.rankScore - a.rankScore || a.index - b.index)

  const seen = new Set<string>()
  const result: ContextSection[] = []
  for (const section of ranked) {
    const key = dedupeKey(section)
    if (seen.has(key)) continue
    seen.add(key)
    const { authorityTier: _authorityTier, rankScore: _rankScore, index: _index, ...clean } = section
    result.push(clean)
  }
  return result
}

export function scoreSection(section: ContextSection): number {
  const citationWeight = Math.min(section.citations.length, 5) * 8
  const tokenPenalty = Math.min(section.tokenEstimate, 2_000) / 100
  return (
    (KIND_WEIGHT[section.kind] ?? 0) +
    (FRESHNESS_WEIGHT[section.freshness] ?? 0) +
    section.priority * 2 +
    section.confidence * 100 +
    citationWeight -
    tokenPenalty
  )
}

function dedupeKey(section: ContextSection): string {
  const citationKey = section.citations
    .map((citation) => `${citation.type}:${citation.ref}:${citation.line ?? ''}:${citation.hash ?? ''}`)
    .sort()
    .join('|')
  if (!citationKey) {
    return createHash('sha1').update(`no-citation\0${section.id}`).digest('hex')
  }

  const normalizedContent = section.content.trim().replace(/\s+/g, ' ').toLowerCase()
  return createHash('sha1').update(`${normalizedContent}\0${citationKey}`).digest('hex')
}
