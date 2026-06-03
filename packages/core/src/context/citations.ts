import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { ContextCitation } from './types.js'

export interface CitationValidationSources {
  cwd?: string
  retainedFileSnapshots?: Array<{ ref: string; hash?: string }>
  messages?: Array<{ id: string; [key: string]: unknown }>
  toolEvents?: Array<{ id: string; [key: string]: unknown }>
  gitEvidence?: Array<{ id?: string; ref?: string; hash?: string }>
  memoryRecords?: Array<{ id: string; [key: string]: unknown }>
  diagnostics?: Array<{ id: string; [key: string]: unknown }>
  ideEvidence?: Array<{ id?: string; ref?: string; [key: string]: unknown }>
  configEvidence?: Array<{ id?: string; ref?: string; [key: string]: unknown }>
  tasks?: Array<{ id?: string; ref?: string; [key: string]: unknown }>
}

export interface CitationValidationResult {
  valid: boolean
  errors: string[]
}

const RAW_REASONING_CITATION_TYPES = new Set(['thinking', 'reasoning', 'reasoning_summary', 'raw_thinking'])

export function containsRawReasoningCitation(citations: Array<ContextCitation | { type: string }>): boolean {
  return citations.some((citation) => RAW_REASONING_CITATION_TYPES.has(citation.type))
}

export function validateCitation(citation: ContextCitation, sources: CitationValidationSources = {}): CitationValidationResult {
  if (containsRawReasoningCitation([citation])) {
    return invalid(`citation ${citation.id} uses raw thinking/reasoning evidence`)
  }

  if (citation.hash && !matchesKnownHash(citation, sources)) {
    return invalid(`citation ${citation.id} hash does not match retained evidence`)
  }

  switch (citation.type) {
    case 'file':
      return validateFileCitation(citation, sources)
    case 'message':
      return existsById(sources.messages, citation.ref) ? ok() : invalid(`message citation ${citation.id} references missing message ${citation.ref}`)
    case 'tool_event':
      return existsById(sources.toolEvents, citation.ref) ? ok() : invalid(`tool citation ${citation.id} references missing tool event ${citation.ref}`)
    case 'git':
      return existsByGitRef(sources.gitEvidence, citation.ref) ? ok() : invalid(`git citation ${citation.id} references missing git evidence ${citation.ref}`)
    case 'memory':
      return existsById(sources.memoryRecords, citation.ref) ? ok() : invalid(`memory citation ${citation.id} references missing accepted memory ${citation.ref}`)
    case 'diagnostic':
      return existsById(sources.diagnostics, citation.ref) ? ok() : invalid(`diagnostic citation ${citation.id} references missing diagnostic ${citation.ref}`)
    case 'ide':
      return existsByRefOrId(sources.ideEvidence, citation.ref) ? ok() : invalid(`ide citation ${citation.id} references missing ide evidence ${citation.ref}`)
    case 'config':
      return existsByRefOrId(sources.configEvidence, citation.ref) ? ok() : invalid(`config citation ${citation.id} references missing config evidence ${citation.ref}`)
    case 'task':
      return existsByRefOrId(sources.tasks, citation.ref) ? ok() : invalid(`task citation ${citation.id} references missing task evidence ${citation.ref}`)
  }
}

export function validateCitations(citations: ContextCitation[], sources: CitationValidationSources = {}): CitationValidationResult {
  if (citations.length === 0) {
    return invalid('durable context requires at least one citation')
  }

  const errors = citations.flatMap((citation) => validateCitation(citation, sources).errors)
  return { valid: errors.length === 0, errors }
}

export function assertCitationsValid(citations: ContextCitation[], sources: CitationValidationSources = {}): CitationValidationResult {
  return validateCitations(citations, sources)
}

function validateFileCitation(citation: ContextCitation, sources: CitationValidationSources): CitationValidationResult {
  if (sources.retainedFileSnapshots?.some((snapshot) => snapshot.ref === citation.ref && (!citation.hash || snapshot.hash === citation.hash))) {
    return ok()
  }

  if (!sources.cwd) {
    return invalid(`file citation ${citation.id} cannot be validated without cwd or retained snapshot`)
  }

  const filePath = isAbsolute(citation.ref) ? citation.ref : join(sources.cwd, citation.ref)
  return existsSync(filePath) ? ok() : invalid(`file citation ${citation.id} references missing file ${citation.ref}`)
}

function matchesKnownHash(citation: ContextCitation, sources: CitationValidationSources): boolean {
  return Boolean(
    sources.retainedFileSnapshots?.some((snapshot) => snapshot.ref === citation.ref && snapshot.hash === citation.hash) ||
      sources.gitEvidence?.some((evidence) => evidence.hash === citation.hash && (evidence.ref === citation.ref || evidence.id === citation.ref))
  )
}

function existsById(items: Array<{ id: string }> | undefined, id: string): boolean {
  return Boolean(items?.some((item) => item.id === id))
}

function existsByGitRef(items: Array<{ id?: string; ref?: string }> | undefined, ref: string): boolean {
  return Boolean(items?.some((item) => item.ref === ref || item.id === ref))
}

function existsByRefOrId(items: Array<{ id?: string; ref?: string }> | undefined, ref: string): boolean {
  return Boolean(items?.some((item) => item.ref === ref || item.id === ref))
}

function ok(): CitationValidationResult {
  return { valid: true, errors: [] }
}

function invalid(error: string): CitationValidationResult {
  return { valid: false, errors: [error] }
}
