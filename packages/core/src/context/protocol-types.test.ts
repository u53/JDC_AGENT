import { describe, expect, it } from 'vitest'
import type {
  ContextBundle,
  ContextDiagnostic,
  ContextFact,
  ContextRequest,
  ContextSection,
  HarvestCandidate,
  HarvestDecision,
  HarvestModelBinding,
  RawEvidence,
  ReasoningCapturePolicy,
} from './types.js'
import { DEFAULT_REASONING_CAPTURE_POLICY } from './types.js'

const message = { id: 'msg_1', role: 'user' as const, content: [{ type: 'text' as const, text: 'Build context.' }], timestamp: 1 }

const citation = { id: 'cit_1', type: 'file' as const, ref: 'packages/core/src/context/types.ts', line: 10 }

const diagnostic: ContextDiagnostic = {
  id: 'diag_1',
  level: 'info',
  source: 'CoreProtocolTest',
  message: 'ok',
  createdAt: 1,
}

describe('core context protocol types', () => {
  it('defines authoritative context records with citations, confidence, freshness, and token cost', () => {
    const request: ContextRequest = {
      sessionId: 'session_1',
      cwd: '/repo',
      userMessage: 'Build context.',
      recentMessages: [message],
      mode: 'code_edit',
      model: 'gpt-5.5',
      runtime: { runLoopId: 'run_1' },
      createdAt: 1,
    }

    const rawEvidence: RawEvidence = {
      id: 'raw_1',
      sessionId: request.sessionId,
      cwd: request.cwd,
      sourceProvider: 'CodeSignalProducer',
      kind: 'file',
      content: 'export interface ContextFact {}',
      metadata: { path: citation.ref },
      capturedAt: 1,
      hash: 'hash_1',
    }

    const fact: ContextFact = {
      id: 'fact_1',
      kind: 'code_entrypoint',
      scope: 'project',
      content: 'Context protocol lives in packages/core/src/context/types.ts.',
      citations: [citation],
      confidence: 0.91,
      freshness: 'live',
      sourceProvider: rawEvidence.sourceProvider,
      createdAt: 1,
      updatedAt: 1,
    }

    const section: ContextSection = {
      id: 'section_1',
      kind: 'relevant_code',
      title: 'Relevant code',
      content: fact.content,
      citations: fact.citations,
      priority: 10,
      confidence: fact.confidence,
      freshness: fact.freshness,
      sourceProvider: fact.sourceProvider,
      tokenEstimate: 12,
    }

    const bundle: ContextBundle = {
      id: 'ctx_1',
      sessionId: request.sessionId,
      requestHash: 'request_hash_1',
      createdAt: 1,
      sections: [section],
      citations: [citation],
      diagnostics: [diagnostic],
      budget: { usedTokens: 12, droppedTokens: 0 },
    }

    expect(bundle.sections[0].tokenEstimate).toBe(12)
    expect(bundle.sections[0].citations[0].ref).toBe('packages/core/src/context/types.ts')
  })

  it('defines harvest decisions, model binding, and immutable no-thinking policy', () => {
    const candidate: HarvestCandidate = {
      sessionId: 'session_1',
      runLoopId: 'run_1',
      userMessage: 'Fix the bug.',
      assistantMessages: [message],
      toolEvents: [{ id: 'tool_1', name: 'Read', status: 'completed' }],
      changedFiles: ['packages/core/src/context/types.ts'],
      createdAt: 1,
    }

    const decision: HarvestDecision = { action: 'skip', reason: 'no_new_fact' }
    const binding: HarvestModelBinding = {
      sessionId: candidate.sessionId,
      providerProtocol: 'openai-responses',
      modelId: 'model_1',
      modelConfig: { model: 'gpt-5.5', maxTokens: 1000 },
      modelGroupId: 'group_1',
      baseUrl: 'https://example.invalid',
      contextWindow: 128000,
    }

    const policy: ReasoningCapturePolicy = DEFAULT_REASONING_CAPTURE_POLICY

    expect(decision.reason).toBe('no_new_fact')
    expect(binding.providerProtocol).toBe('openai-responses')
    expect(policy).toEqual({
      captureRawThinking: false,
      captureReasoningSummary: 'ephemeral_diagnostics',
      allowAsCitation: false,
      allowAsMemorySource: false,
    })
  })
})
