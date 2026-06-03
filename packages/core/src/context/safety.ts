import type { ZodObject, ZodRawShape } from 'zod'
import { containsRawReasoningCitation, type CitationValidationSources, validateCitations } from './citations.js'
import {
  CodeTaskPayloadSchema,
  ArtifactSummaryPayloadSchema,
  ConversationStatePayloadSchema,
  MemoryCandidatePayloadSchema,
  ProjectProfilePayloadSchema,
  QaIssuePayloadSchema,
  RuntimeNarrativePayloadSchema,
  TeamLedgerPayloadSchema,
  WorkflowRulePayloadSchema,
  validateContextFact,
  validateDistillerEnvelope,
} from './schemas.js'
import type { ContextFact, DistillerEnvelope, HarvestCandidate, HarvestDecision } from './types.js'
import {
  containsRawReasoningData,
  containsSensitiveContext,
  redactHarvestCandidateForDistillation,
  type RedactionResult,
} from './redaction.js'
export { routeHarvestCandidate as classifyHarvestCandidate } from './harvest-router.js'

export interface PrepareCandidateOptions {
  skipSensitiveCandidates?: boolean
}

export interface PreparedHarvestCandidate {
  candidate: HarvestCandidate
  redaction: RedactionResult<HarvestCandidate>
  safeForDistillation: boolean
  decision?: HarvestDecision
}

export interface AcceptanceOptions {
  minConfidence?: number
  citationSources?: CitationValidationSources
}

export interface AcceptanceResult<T = unknown> {
  accepted: boolean
  value?: T
  errors: string[]
}

const DEFAULT_MIN_CONFIDENCE = 0.8
export function prepareCandidateForDistillation(candidate: HarvestCandidate, options: PrepareCandidateOptions = {}): PreparedHarvestCandidate {
  const redaction = redactHarvestCandidateForDistillation(candidate)
  if (options.skipSensitiveCandidates && redaction.redacted) {
    return {
      candidate: redaction.value,
      redaction,
      safeForDistillation: false,
      decision: { action: 'skip', reason: 'sensitive_content' },
    }
  }

  return {
    candidate: redaction.value,
    redaction,
    safeForDistillation: true,
  }
}

export function validateDistillerEnvelopeForAcceptance<T>(envelope: DistillerEnvelope<T>, options: AcceptanceOptions = {}): AcceptanceResult<DistillerEnvelope<T>> {
  const errors: string[] = []
  const parsed = validateDistillerEnvelope(envelope)
  if (!parsed.success) errors.push(`schema invalid: ${parsed.error.message}`)

  const payloadResult = validatePayloadForDistiller(envelope)
  errors.push(...payloadResult.errors)

  if (envelope.confidence < minConfidence(options)) errors.push(`confidence ${envelope.confidence} is below minimum ${minConfidence(options)}`)
  if (containsRawReasoningData(envelope)) errors.push('payload contains raw thinking/reasoning data')
  if (containsSensitiveContext(envelope.payload) || containsSensitiveContext(envelope.citations)) errors.push('payload contains sensitive content')

  const citationResult = validateCitations(envelope.citations, options.citationSources)
  if (!citationResult.valid) errors.push(...citationResult.errors)

  if (isContextFact(envelope.payload)) {
    const factResult = rejectUnsafeDurableFact(envelope.payload, options)
    errors.push(...factResult.errors)
  }

  return errors.length === 0 ? { accepted: true, value: envelope, errors: [] } : { accepted: false, errors: unique(errors) }
}

export function rejectUnsafeDurableFact(fact: ContextFact, options: AcceptanceOptions = {}): AcceptanceResult<ContextFact> {
  const errors: string[] = []
  const parsed = validateContextFact(fact)
  if (!parsed.success) errors.push(`schema invalid: ${parsed.error.message}`)
  if (fact.confidence < minConfidence(options)) errors.push(`confidence ${fact.confidence} is below minimum ${minConfidence(options)}`)
  if (containsRawReasoningCitation(fact.citations)) errors.push('fact uses raw thinking/reasoning citation evidence')
  if (containsRawReasoningData(fact)) errors.push('fact contains raw thinking/reasoning data')
  if (containsSensitiveContext(fact.content)) errors.push('fact contains sensitive content')

  const citationResult = validateCitations(fact.citations, options.citationSources)
  if (!citationResult.valid) errors.push(...citationResult.errors)

  return errors.length === 0 ? { accepted: true, value: fact, errors: [] } : { accepted: false, errors: unique(errors) }
}

export function assertDistillerEnvelopeAccepted<T>(envelope: DistillerEnvelope<T>, options: AcceptanceOptions = {}): DistillerEnvelope<T> {
  const result = validateDistillerEnvelopeForAcceptance(envelope, options)
  if (!result.accepted) throw new Error(`Distiller output rejected: ${result.errors.join('; ')}`)
  return envelope
}

function minConfidence(options: AcceptanceOptions): number {
  return options.minConfidence ?? DEFAULT_MIN_CONFIDENCE
}

function stableAssistantEvidenceText(block: unknown): string {
  if (!block || typeof block !== 'object') return ''
  const typed = block as { type?: string; text?: string; content?: string; is_error?: boolean }
  if (typed.type === 'thinking') return ''
  if (typed.type === 'text' && typeof typed.text === 'string') return typed.text
  if (typed.type === 'tool_result' && typeof typed.content === 'string') return typed.content
  return ''
}

function validatePayloadForDistiller(envelope: DistillerEnvelope<unknown>): { errors: string[] } {
  const schema = payloadSchemaForDistiller(envelope.distiller)
  if (!schema) return { errors: [`unknown distiller ${envelope.distiller}`] }
  const parsed = schema.strict().safeParse(envelope.payload)
  if (!parsed.success) return { errors: [`payload schema invalid: ${parsed.error.message}`] }

  const strippedPaths = findStrippedPayloadPaths(envelope.payload, parsed.data, 'payload')
  return strippedPaths.length === 0 ? { errors: [] } : { errors: [`payload schema invalid: unrecognized key(s) ${strippedPaths.join(', ')}`] }
}

function findStrippedPayloadPaths(input: unknown, parsed: unknown, path: string): string[] {
  if (Array.isArray(input) && Array.isArray(parsed)) {
    return input.flatMap((item, index) => findStrippedPayloadPaths(item, parsed[index], `${path}[${index}]`))
  }

  if (!isObjectRecord(input) || !isObjectRecord(parsed)) return []

  return Object.keys(input).flatMap((key) => {
    const nextPath = `${path}.${key}`
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) return [nextPath]
    return findStrippedPayloadPaths(input[key], parsed[key], nextPath)
  })
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function payloadSchemaForDistiller(distiller: string): ZodObject<ZodRawShape> | undefined {
  switch (distiller) {
    case 'RuntimeNarrativeDistiller':
      return RuntimeNarrativePayloadSchema
    case 'ConversationStateDistiller':
      return ConversationStatePayloadSchema
    case 'MemoryCuratorDistiller':
      return MemoryCandidatePayloadSchema
    case 'ProjectProfileDistiller':
      return ProjectProfilePayloadSchema
    case 'CodeTaskDistiller':
      return CodeTaskPayloadSchema
    case 'TeamLedgerDistiller':
      return TeamLedgerPayloadSchema
    case 'ArtifactSummaryDistiller':
      return ArtifactSummaryPayloadSchema
    case 'QaIssueDistiller':
      return QaIssuePayloadSchema
    case 'WorkflowRuleDistiller':
      return WorkflowRulePayloadSchema
    default:
      return undefined
  }
}

function isContextFact(value: unknown): value is ContextFact {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'id' in value &&
      'kind' in value &&
      'scope' in value &&
      'content' in value &&
      'citations' in value &&
      'confidence' in value &&
      'freshness' in value &&
      'sourceProvider' in value
  )
}

function unique(errors: string[]): string[] {
  return [...new Set(errors)]
}
