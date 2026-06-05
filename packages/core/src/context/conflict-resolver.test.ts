import { describe, expect, it } from 'vitest'
import { resolveContextConflicts } from './conflict-resolver.js'
import { ContextDiagnosticSchema } from './schemas.js'
import type { ContextRequest, ContextSection } from './types.js'

describe('Context conflict resolver', () => {
  it('suppresses raw conversation transcript when provider messages already carry it', () => {
    const result = resolveContextConflicts(request({ transcriptAlreadyInModel: true }), [
      section({
        id: 'conversation_live',
        kind: 'conversation_state',
        title: 'Conversation state',
        sourceProvider: 'ConversationSignalProvider',
        content: 'user: duplicate',
        ownership: { authority: 'derived_state', topic: 'conversation', conflictPolicy: 'suppress_if_carried' },
      }),
      section({
        id: 'runtime_live',
        kind: 'runtime_state',
        title: 'Runtime state',
        sourceProvider: 'RuntimeSignalProvider',
        content: 'Read failed',
        ownership: { authority: 'runtime_evidence', topic: 'runtime', conflictPolicy: 'render' },
      }),
    ])

    expect(result.sections.map((item) => item.id)).toEqual(['runtime_live'])
    expect(result.suppressed).toEqual([{ id: 'conversation_live', reason: 'transcript_already_in_model_messages' }])
    expect(ContextDiagnosticSchema.safeParse(result.diagnostics[0]).success).toBe(true)
    expect(result.diagnostics[0]).toMatchObject({ visibleInPrimaryUi: false })
    expect(result.diagnostics[0]?.citation).toBeUndefined()
  })

  it('suppresses git state when detailed git status is already carried by system prompt', () => {
    const result = resolveContextConflicts(request({
      carriedContext: { projectInstructionRefs: [], gitStatusInSystemPrompt: true, taskRefs: [] },
    }), [
      section({
        id: 'git_live',
        kind: 'git_state',
        title: 'Git state',
        sourceProvider: 'GitSignalProvider',
        content: 'branch: main',
        ownership: { authority: 'live_state', topic: 'git', conflictPolicy: 'suppress_if_carried' },
      }),
    ])

    expect(result.sections).toEqual([])
    expect(result.suppressed).toEqual([{ id: 'git_live', reason: 'git_state_already_in_system_prompt' }])
  })
})

function request(overrides: Partial<ContextRequest> = {}): ContextRequest {
  return {
    sessionId: 'session_1',
    cwd: '/repo',
    userMessage: 'fix retry',
    recentMessages: [],
    mode: 'code_edit',
    model: 'test-model',
    runtime: {},
    createdAt: 1,
    ...overrides,
  }
}

function section(overrides: Partial<ContextSection>): ContextSection {
  return {
    id: 'section_1',
    kind: 'memory',
    title: 'Section',
    content: 'content',
    citations: [{ id: 'cit_1', type: 'message', ref: 'msg_1' }],
    priority: 50,
    confidence: 0.9,
    freshness: 'live',
    sourceProvider: 'test',
    tokenEstimate: 1,
    ...overrides,
  }
}
