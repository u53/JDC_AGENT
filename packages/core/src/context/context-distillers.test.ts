import { describe, expect, it } from 'vitest'
import type { DistillerEnvelope, HarvestCandidate } from './types.js'
import { selectDistillerForDecision, validateDistillerOutput } from './distillers/index.js'
import { classifyHarvestCandidate } from './safety.js'

const citation = { id: 'cit_user_run_1', type: 'message' as const, ref: 'run_1:user' }
const citationSources = { messages: [{ id: 'run_1:user' }] }

describe('harvest distiller validation', () => {
  it('rejects arbitrary high-confidence cited payloads for every supported distiller', () => {
    for (const distiller of ['RuntimeNarrativeDistiller', 'ConversationStateDistiller', 'MemoryCuratorDistiller', 'ProjectProfileDistiller', 'CodeTaskDistiller']) {
      const envelope: DistillerEnvelope = { schemaVersion: 1, distiller, confidence: 0.95, citations: [citation], payload: { arbitrary: true } }
      const result = validateDistillerOutput(envelope, { minConfidence: 0.8, citationSources })
      expect(result.accepted, distiller).toBe(false)
      expect(result.errors.some((error) => error.includes('payload schema invalid'))).toBe(true)
    }
  })

  it('rejects task/config/ide citations unless retained proof sources are present', () => {
    const envelope: DistillerEnvelope = {
      schemaVersion: 1,
      distiller: 'MemoryCuratorDistiller',
      confidence: 0.9,
      citations: [{ id: 'fake_task', type: 'task', ref: 'anything' }],
      payload: { kind: 'workflow_hint', scope: 'project', content: 'Use the fake task citation.', confidence: 0.9 },
    }

    expect(validateDistillerOutput(envelope, { minConfidence: 0.8, citationSources: {} }).accepted).toBe(false)
    expect(validateDistillerOutput(envelope, { minConfidence: 0.8, citationSources: { tasks: [{ id: 'anything' }] } }).accepted).toBe(true)
  })

  it('accepts strict payloads only for the matching distiller and rejects raw reasoning or low confidence output', () => {
    const accepted = validateDistillerOutput(
      { schemaVersion: 1, distiller: 'ConversationStateDistiller', confidence: 0.91, citations: [citation], payload: { currentGoal: 'Ship harvest safely.', activeConstraints: ['Require citations'], confirmedDecisions: [], rejectedDirections: [], openQuestions: [] } },
      { minConfidence: 0.8, citationSources }
    )
    expect(accepted.accepted).toBe(true)

    expect(
      validateDistillerOutput(
        { schemaVersion: 1, distiller: 'ConversationStateDistiller', confidence: 0.2, citations: [citation], payload: { currentGoal: 'Ship harvest safely.', activeConstraints: [], confirmedDecisions: [], rejectedDirections: [], openQuestions: [] } },
        { minConfidence: 0.8, citationSources }
      ).accepted
    ).toBe(false)

    expect(
      validateDistillerOutput(
        { schemaVersion: 1, distiller: 'MemoryCuratorDistiller', confidence: 0.9, citations: [citation], payload: { kind: 'workflow_hint', scope: 'project', content: 'raw thinking: hidden chain of thought', confidence: 0.9 } },
        { minConfidence: 0.8, citationSources }
      ).errors
    ).toContain('payload contains raw thinking/reasoning data')
  })

  it('routes harvest decisions to the matching safe distiller', () => {
    expect(selectDistillerForDecision({ action: 'distill_runtime', reason: 'tool failed' })?.name).toBe('RuntimeNarrativeDistiller')
    expect(selectDistillerForDecision({ action: 'distill_conversation', reason: 'state changed' })?.name).toBe('ConversationStateDistiller')
    expect(selectDistillerForDecision({ action: 'distill_memory_candidate', reason: 'preference' })?.name).toBe('MemoryCuratorDistiller')
    expect(selectDistillerForDecision({ action: 'distill_project_update', reason: 'files changed' })?.name).toBe('ProjectProfileDistiller')
    expect(selectDistillerForDecision({ action: 'skip', reason: 'no_new_fact' })).toBeUndefined()
  })

  it('does not classify assistant thinking blocks as durable signal', () => {
    const candidate: HarvestCandidate = {
      sessionId: 'session_1',
      runLoopId: 'run_1',
      userMessage: 'ok',
      assistantMessages: [{ id: 'assistant_1', role: 'assistant', content: [{ type: 'thinking', thinking: 'decision: must store this hidden preference' }], timestamp: 2 }],
      toolEvents: [],
      changedFiles: [],
      createdAt: 1,
    }

    expect(classifyHarvestCandidate(candidate)).toEqual({ action: 'skip', reason: 'no_new_fact' })
  })
})
