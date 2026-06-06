import path from 'node:path'
import { readFileSafe, scanProject, toPosix } from '../../context-engine/indexer/scanner.js'
import { languageForPath } from '../../context-engine/parser/languages.js'
import { tokenizeQueryText } from '../../context-engine/query-tokenizer.js'
import type { ContextEvidenceRequirement } from '../types.js'

export interface FallbackCodeMatch {
  file: string
  reason: 'requirement_file_match' | 'requirement_symbol_match' | 'query_text_match'
  line?: number
  preview: string
}

export interface FallbackCodeEvidenceResult {
  content: string
  matches: FallbackCodeMatch[]
}

interface FallbackCandidate {
  file: string
  line?: number
  preview?: string
  reason?: Exclude<FallbackCodeMatch['reason'], 'requirement_file_match'>
}

interface FallbackTerm {
  value: string
  reason: Exclude<FallbackCodeMatch['reason'], 'requirement_file_match'>
}

export async function collectFallbackCodeEvidence(options: {
  cwd: string
  requirements: ContextEvidenceRequirement[]
  query?: string
  now?: () => number
}): Promise<FallbackCodeEvidenceResult> {
  const files = explicitRequirementFiles(options.cwd, options.requirements)
  const terms = buildFallbackTerms(options.requirements, options.query ?? '')
  const candidates: FallbackCandidate[] = files.length
    ? files.map((file) => ({ file } satisfies FallbackCandidate))
    : await scanFallbackCandidates(options.cwd, terms)
  const matches: FallbackCodeMatch[] = []

  for (const candidate of candidates) {
    const content = await readFileSafe(path.join(options.cwd, candidate.file))
    if (content === null) continue
    const line = candidate.line && candidate.preview && candidate.reason
      ? { line: candidate.line, preview: candidate.preview, reason: candidate.reason }
      : firstRelevantLine(content, terms)
    const firstLine = firstNonEmptyLine(content)
    if (!line && !files.length && !candidate.reason) continue
    matches.push({
      file: candidate.file,
      reason: files.length ? 'requirement_file_match' : line?.reason ?? candidate.reason ?? 'query_text_match',
      line: line?.line ?? firstLine?.line,
      preview: line?.preview ?? firstLine?.preview ?? '',
    })
  }

  return {
    matches,
    content: matches.length
      ? ['Fallback code matches while index warms:', ...matches.map((match) => `- ${match.file}${match.line ? `:${match.line}` : ''} (${match.reason}) ${match.preview}`)].join('\n')
      : 'Code index is warming; fallback found no explicit code file matches for this turn.',
  }
}

async function scanFallbackCandidates(cwd: string, terms: FallbackTerm[]): Promise<FallbackCandidate[]> {
  if (!terms.length) return []
  const candidates: Array<FallbackCandidate & { score: number }> = []
  for (const file of await scanProject(cwd)) {
    const content = await readFileSafe(file.absPath)
    if (content === null) continue
    const line = firstRelevantLine(content, terms)
    const pathScore = scoreCandidatePath(file.relPath, terms)
    if (!line && pathScore.score === 0) continue
    candidates.push({
      file: file.relPath,
      line: line?.line,
      preview: line?.preview,
      reason: line?.reason ?? pathScore.reason,
      score: (line ? 10 : 0) + pathScore.score,
    })
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .map(({ score: _score, ...candidate }) => candidate)
}

function scoreCandidatePath(file: string, terms: FallbackTerm[]): { score: number; reason?: FallbackTerm['reason'] } {
  const searchablePath = normalizeSearchText(stripLineSuffix(file))
  let score = 0
  let reason: FallbackTerm['reason'] | undefined
  for (const term of terms) {
    const searchableTerm = normalizeSearchText(term.value)
    if (searchableTerm.length < 2 || !searchablePath.includes(searchableTerm)) continue
    const weight = term.reason === 'requirement_symbol_match' ? 5 : 3
    score += weight
    reason ??= term.reason
  }
  return { score, reason }
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function explicitRequirementFiles(cwd: string, requirements: ContextEvidenceRequirement[]): string[] {
  const seen = new Set<string>()
  const files: string[] = []
  for (const requirement of requirements) {
    for (const relatedFile of requirement.relatedFiles) {
      const file = normalizeExplicitFile(cwd, relatedFile)
      if (!file || seen.has(file)) continue
      seen.add(file)
      files.push(file)
    }
  }
  return files
}

function normalizeExplicitFile(cwd: string, relatedFile: string): string | null {
  const cleaned = stripLineSuffix(relatedFile.trim().replace(/\\/g, '/').replace(/^\.\//, ''))
  if (!cleaned || cleaned.includes('\0') || path.posix.isAbsolute(cleaned) || path.isAbsolute(cleaned)) return null
  const normalized = path.posix.normalize(cleaned)
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null
  if (!languageForPath(normalized)) return null
  const resolved = path.resolve(cwd, normalized)
  const relative = path.relative(cwd, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return toPosix(relative)
}

function stripLineSuffix(value: string): string {
  return value.replace(/:(\d+)(?::\d+)?$/, '')
}

function buildFallbackTerms(requirements: ContextEvidenceRequirement[], query: string): FallbackTerm[] {
  const terms: FallbackTerm[] = []
  for (const requirement of requirements) {
    terms.push(...requirement.relatedSymbols.map((value) => ({ value, reason: 'requirement_symbol_match' as const })))
    terms.push(...tokenizeQueryText(requirement.query).map((token) => ({ value: token.value, reason: 'query_text_match' as const })))
  }
  terms.push(...tokenizeQueryText(query).map((token) => ({ value: token.value, reason: 'query_text_match' as const })))
  return dedupeTerms(terms.filter((term) => term.value.trim().length > 1))
}

function firstRelevantLine(content: string, terms: FallbackTerm[]): { line: number; preview: string; reason: FallbackTerm['reason'] } | null {
  const lines = content.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const lower = lines[index].toLowerCase()
    const match = terms.find((term) => lower.includes(term.value.toLowerCase()))
    if (match) return { line: index + 1, preview: lines[index].trim(), reason: match.reason }
  }
  return null
}

function firstNonEmptyLine(content: string): { line: number; preview: string } | null {
  const lines = content.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const preview = lines[index].trim()
    if (preview) return { line: index + 1, preview }
  }
  return null
}

function dedupeTerms(terms: FallbackTerm[]): FallbackTerm[] {
  const seen = new Set<string>()
  const out: FallbackTerm[] = []
  for (const term of terms) {
    const key = term.value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(term)
  }
  return out
}
