import path from 'node:path'
import { readFileSafe, toPosix } from '../../context-engine/indexer/scanner.js'
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
  const matches: FallbackCodeMatch[] = []

  for (const file of files) {
    const content = await readFileSafe(path.join(options.cwd, file))
    if (content === null) continue
    const line = firstRelevantLine(content, terms)
    matches.push({
      file,
      reason: 'requirement_file_match',
      line: line?.line ?? firstNonEmptyLine(content)?.line,
      preview: line?.preview ?? firstNonEmptyLine(content)?.preview ?? '',
    })
  }

  return {
    matches,
    content: matches.length
      ? ['Fallback code matches while index warms:', ...matches.map((match) => `- ${match.file}${match.line ? `:${match.line}` : ''} (${match.reason}) ${match.preview}`)].join('\n')
      : 'Code index is warming; fallback found no explicit code file matches for this turn.',
  }
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

function firstRelevantLine(content: string, terms: FallbackTerm[]): { line: number; preview: string } | null {
  const lines = content.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const lower = lines[index].toLowerCase()
    const match = terms.find((term) => lower.includes(term.value.toLowerCase()))
    if (match) return { line: index + 1, preview: lines[index].trim() }
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
