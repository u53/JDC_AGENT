import { describe, expect, it } from 'vitest'
import type { ContextCitation, ContextFact, DistillerEnvelope, HarvestCandidate } from './types.js'
import {
  classifyHarvestCandidate,
  prepareCandidateForDistillation,
  rejectUnsafeDurableFact,
  validateDistillerEnvelopeForAcceptance,
} from './safety.js'

const citation: ContextCitation = { id: 'cit_msg_1', type: 'message', ref: 'msg_1' }

const memoryPayload = {
  kind: 'workflow_hint' as const,
  scope: 'project' as const,
  content: 'Context facts require citations before storage.',
  confidence: 0.9,
}

const envelope: DistillerEnvelope<typeof memoryPayload> = {
  schemaVersion: 1,
  distiller: 'MemoryCuratorDistiller',
  confidence: 0.9,
  citations: [citation],
  payload: memoryPayload,
}

const fact: ContextFact = {
  id: 'fact_1',
  kind: 'workflow_rule',
  scope: 'project',
  content: 'Context facts require citations before storage.',
  citations: [citation],
  confidence: 0.9,
  freshness: 'recent',
  sourceProvider: 'TestDistiller',
  createdAt: 1,
  updatedAt: 1,
}

const candidate: HarvestCandidate = {
  sessionId: 'session_1',
  runLoopId: 'run_1',
  userMessage: 'Remember my api key sk-proj-1234567890abcdef1234567890abcdef.',
  assistantMessages: [],
  toolEvents: [],
  changedFiles: [],
  createdAt: 1,
}

describe('context safety guardrails', () => {
  it('redacts harvest candidates before distillation and reports skipped sensitive candidates', () => {
    const prepared = prepareCandidateForDistillation(candidate)

    expect(prepared.safeForDistillation).toBe(true)
    expect(JSON.stringify(prepared.candidate)).not.toContain('sk-proj-1234567890')
    expect(prepared.redaction.redacted).toBe(true)

    const strictPrepared = prepareCandidateForDistillation(candidate, { skipSensitiveCandidates: true })
    expect(strictPrepared.safeForDistillation).toBe(false)
    expect(strictPrepared.decision).toEqual({ action: 'skip', reason: 'sensitive_content' })
  })

  it('treats quoted session, cookie, and bearer assignments as sensitive safety input', () => {
    expect(classifyHarvestCandidate({ ...candidate, userMessage: 'Remember session_key="quoted-session-secret" for the staging account.' })).toEqual({
      action: 'skip',
      reason: 'sensitive_content',
    })
    expect(rejectUnsafeDurableFact({ ...fact, content: "Deployment evidence included cookie: 'quoted-cookie-secret'." }).errors).toContain('fact contains sensitive content')
    expect(
      validateDistillerEnvelopeForAcceptance({ ...envelope, payload: { ...memoryPayload, content: 'The bearer = "quoted-bearer-secret" value was rotated.' } }, { minConfidence: 0.8 }).errors
    ).toContain('payload contains sensitive content')
  })

  it('skips greetings, acknowledgements, and turns with no durable signals', () => {
    expect(classifyHarvestCandidate({ ...candidate, userMessage: 'hi', changedFiles: [] })).toEqual({ action: 'skip', reason: 'greeting_or_smalltalk' })
    expect(classifyHarvestCandidate({ ...candidate, userMessage: 'ok', changedFiles: [] })).toEqual({ action: 'skip', reason: 'no_new_fact' })
    expect(classifyHarvestCandidate({ ...candidate, userMessage: 'continue', changedFiles: [] })).toEqual({ action: 'skip', reason: 'no_new_fact' })
  })

  it('accepts distiller envelopes only after schema, citation, confidence, and sensitive-content validation', () => {
    const accepted = validateDistillerEnvelopeForAcceptance(envelope, {
      minConfidence: 0.8,
      citationSources: { messages: [{ id: 'msg_1' }] },
    })

    expect(accepted.accepted).toBe(true)
    expect(accepted.errors).toEqual([])

    expect(
      validateDistillerEnvelopeForAcceptance({ ...envelope, citations: [] }, { minConfidence: 0.8 }).accepted
    ).toBe(false)
    expect(validateDistillerEnvelopeForAcceptance({ ...envelope, confidence: 0.2 }, { minConfidence: 0.8 }).errors).toContain('confidence 0.2 is below minimum 0.8')
    expect(
      validateDistillerEnvelopeForAcceptance({ ...envelope, payload: { ...memoryPayload, content: 'token=ghp_1234567890abcdefghijklmnopqrstuvwxyz' } }, { minConfidence: 0.8 }).errors
    ).toContain('payload contains sensitive content')
  })

  it('rejects unknown distiller kinds and exposes the rejection reason', () => {
    const result = validateDistillerEnvelopeForAcceptance(
      { ...envelope, distiller: 'UnknownDistiller', payload: { summary: 'uncited unknown output' } },
      { minConfidence: 0.8, citationSources: { messages: [{ id: 'msg_1' }] } }
    )

    expect(result.accepted).toBe(false)
    expect(result.errors).toContain('unknown distiller UnknownDistiller')
  })

  it('rejects extra untrusted payload fields for known distiller schemas', () => {
    const result = validateDistillerEnvelopeForAcceptance(
      { ...envelope, payload: { ...memoryPayload, untrustedSummary: 'extra AI-generated data without schema support' } as any },
      { minConfidence: 0.8, citationSources: { messages: [{ id: 'msg_1' }] } }
    )

    expect(result.accepted).toBe(false)
    expect(result.errors.some((error) => error.includes('payload schema invalid'))).toBe(true)
  })

  it('rejects nested untrusted payload fields for known distiller schemas', () => {
    const projectProfile = validateDistillerEnvelopeForAcceptance(
      {
        ...envelope,
        distiller: 'ProjectProfileDistiller',
        payload: {
          projectPurpose: 'Ship JDC Context Engine safely.',
          packageBoundaries: [
            {
              name: '@jdcagnet/core',
              path: 'packages/core',
              responsibility: 'Core runtime and context services.',
              untrustedSummary: 'nested AI-generated field outside ProjectProfilePayloadSchema',
            },
          ],
          commands: [{ name: 'test', command: 'pnpm --filter @jdcagnet/core test', purpose: 'Run core tests.' }],
          architectureNotes: ['Distiller payloads must be schema-bound.'],
        } as any,
      },
      { minConfidence: 0.8, citationSources: { messages: [{ id: 'msg_1' }] } }
    )

    expect(projectProfile.accepted).toBe(false)
    expect(projectProfile.errors.some((error) => error.includes('payload schema invalid') && error.includes('payload.packageBoundaries[0].untrustedSummary'))).toBe(true)

    const codeTask = validateDistillerEnvelopeForAcceptance(
      {
        ...envelope,
        distiller: 'CodeTaskDistiller',
        payload: {
          relevantSymbols: [
            {
              name: 'validateDistillerEnvelopeForAcceptance',
              file: 'packages/core/src/context/safety.ts',
              reason: 'Acceptance helper owns schema guardrails.',
              untrustedSummary: 'nested AI-generated field outside CodeTaskPayloadSchema',
            },
          ],
          relevantFiles: [{ file: 'packages/core/src/context/safety.ts', reason: 'Acceptance validation implementation.' }],
          suggestedTools: [{ tool: 'Read', input: { file_path: 'packages/core/src/context/safety.ts' }, reason: 'Inspect implementation.' }],
        } as any,
      },
      { minConfidence: 0.8, citationSources: { messages: [{ id: 'msg_1' }] } }
    )

    expect(codeTask.accepted).toBe(false)
    expect(codeTask.errors.some((error) => error.includes('payload schema invalid') && error.includes('payload.relevantSymbols[0].untrustedSummary'))).toBe(true)
  })

  it('rejects durable facts with raw thinking or reasoning anywhere in content, citations, or metadata-shaped payload', () => {
    expect(rejectUnsafeDurableFact({ ...fact, content: 'raw thinking: hidden chain of thought' }).accepted).toBe(false)
    expect(rejectUnsafeDurableFact({ ...fact, citations: [{ id: 'bad', type: 'thinking' as any, ref: 'raw' }] }).errors).toContain('fact uses raw thinking/reasoning citation evidence')
    expect(
      validateDistillerEnvelopeForAcceptance(
        {
          ...envelope,
          payload: {
            ...memoryPayload,
            reasoning: 'hidden model reasoning',
          } as any,
        },
        { minConfidence: 0.8 }
      ).errors
    ).toContain('payload contains raw thinking/reasoning data')
  })

  it('rejects durable facts when citations are missing or absent from external validation sources', () => {
    expect(rejectUnsafeDurableFact({ ...fact, citations: [] }).accepted).toBe(false)

    const uncitedFact = { ...fact, citations: [{ id: 'cit_missing_message', type: 'message' as const, ref: 'missing_message' }] }
    const rejected = rejectUnsafeDurableFact(uncitedFact, { citationSources: { messages: [] } })
    expect(rejected.accepted).toBe(false)
    expect(rejected.errors).toContain('message citation cit_missing_message references missing message missing_message')

    const accepted = rejectUnsafeDurableFact(uncitedFact, {
      citationSources: { messages: [{ id: 'missing_message', source: 'stored_raw_evidence' }] },
    })
    expect(accepted.accepted).toBe(true)
  })
})
