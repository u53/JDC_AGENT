import { describe, expect, it } from 'vitest'
import {
  ContextBundleSchema,
  ContextCitationSchema,
  ContextFactSchema,
  ContextRequestSchema,
  DistillerEnvelopeSchema,
  HarvestDecisionSchema,
  MemoryRecordSchema,
  validateContextBundle,
  validateContextFact,
  validateDistillerEnvelope,
  validateMemoryRecord,
} from './schemas.js'

const citation = { id: 'cit_1', type: 'file', ref: 'packages/core/src/context/types.ts', line: 1 }

const fact = {
  id: 'fact_1',
  kind: 'workflow_rule',
  scope: 'project',
  content: 'Durable facts require citations.',
  citations: [citation],
  confidence: 0.95,
  freshness: 'recent',
  sourceProvider: 'ConversationStateDistiller',
  createdAt: 1,
  updatedAt: 1,
}

describe('context protocol schemas', () => {
  it('accepts valid context facts, bundles, harvest decisions, memory records, and distiller envelopes', () => {
    const bundle = {
      id: 'ctx_1',
      sessionId: 'session_1',
      requestHash: 'hash_1',
      createdAt: 1,
      sections: [
        {
          id: 'section_1',
          kind: 'memory',
          title: 'Memory',
          content: fact.content,
          citations: [citation],
          priority: 1,
          confidence: 0.95,
          freshness: 'recent',
          sourceProvider: 'MemorySignalProducer',
          tokenEstimate: 8,
          ownership: {
            authority: 'durable_memory',
            topic: 'memory',
            conflictPolicy: 'render',
          },
        },
      ],
      citations: [citation],
      diagnostics: [],
      budget: { maxTokens: 100, usedTokens: 8, droppedTokens: 0 },
    }

    const memoryRecord = {
      id: 'memory_1',
      kind: 'workflow_hint',
      scope: 'project',
      content: 'Run context validation before storing memory.',
      citations: [citation],
      confidence: 0.9,
      createdAt: 1,
      updatedAt: 1,
    }

    const envelope = {
      schemaVersion: 1,
      distiller: 'MemoryCuratorDistiller',
      confidence: 0.92,
      citations: [citation],
      payload: { currentGoal: 'Implement protocol', activeConstraints: [], confirmedDecisions: [], rejectedDirections: [], openQuestions: [] },
    }

    const request = {
      sessionId: 'session_1',
      cwd: '/repo',
      userMessage: 'fix retry',
      recentMessages: [],
      transcriptAlreadyInModel: true,
      carriedContext: {
        projectInstructionRefs: ['JDCAGNET.md', 'AGENTS.md'],
        gitStatusInSystemPrompt: false,
        taskRefs: ['task_1'],
      },
      mode: 'code_edit',
      model: 'test-model',
      runtime: {},
      createdAt: 1,
    }

    expect(ContextCitationSchema.parse(citation).ref).toBe(citation.ref)
    expect(validateContextFact(fact).success).toBe(true)
    expect(validateContextBundle(bundle).success).toBe(true)
    expect(HarvestDecisionSchema.parse({ action: 'skip', reason: 'greeting_or_smalltalk' }).reason).toBe('greeting_or_smalltalk')
    expect(validateMemoryRecord(memoryRecord).success).toBe(true)
    expect(validateDistillerEnvelope(envelope).success).toBe(true)
    expect(ContextFactSchema.parse(fact).confidence).toBe(0.95)
    expect(ContextBundleSchema.parse(bundle).budget.usedTokens).toBe(8)
    expect(ContextRequestSchema.parse(request).carriedContext?.projectInstructionRefs).toEqual(['JDCAGNET.md', 'AGENTS.md'])
    expect(MemoryRecordSchema.parse(memoryRecord).scope).toBe('project')
    expect(DistillerEnvelopeSchema.parse(envelope).schemaVersion).toBe(1)
  })

  it('rejects durable facts and memories without citations or accepted confidence', () => {
    expect(validateContextFact({ ...fact, citations: [] }).success).toBe(false)
    expect(validateContextFact({ ...fact, confidence: 0 }).success).toBe(false)
    expect(validateMemoryRecord({ ...fact, id: 'memory_1', kind: 'workflow_hint', citations: [] }).success).toBe(false)
    expect(validateDistillerEnvelope({ schemaVersion: 1, distiller: 'BadDistiller', confidence: 0.9, citations: [], payload: {} }).success).toBe(false)
  })

  it('rejects raw thinking or reasoning as citation evidence', () => {
    expect(() => ContextCitationSchema.parse({ id: 'cit_thinking', type: 'thinking', ref: 'raw-thinking' })).toThrow()
    expect(() => ContextCitationSchema.parse({ id: 'cit_reasoning', type: 'reasoning', ref: 'reasoning-summary' })).toThrow()
  })
})
