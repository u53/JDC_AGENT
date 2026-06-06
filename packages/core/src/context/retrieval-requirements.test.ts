import { describe, expect, it } from 'vitest'
import { deriveContextEvidenceRequirements } from './retrieval-requirements.js'
import type { ContextRequest } from './types.js'

function request(userMessage: string, mode: ContextRequest['mode'] = 'chat'): ContextRequest {
  return {
    sessionId: 'session_requirements',
    cwd: '/repo',
    userMessage,
    recentMessages: [],
    mode,
    model: 'test-model',
    runtime: {},
    createdAt: 1_000,
  }
}

describe('deriveContextEvidenceRequirements', () => {
  it('extracts path and symbol hints from Chinese code-edit requests', () => {
    const requirements = deriveContextEvidenceRequirements(request('修复 packages/core/src/session.ts 里面 backgroundTasks 的 completion 记录'))

    expect(requirements).toEqual([
      expect.objectContaining({
        id: 'req_relevant_code',
        kind: 'relevant_code',
        priority: 'must',
        query: '修复 packages/core/src/session.ts 里面 backgroundTasks 的 completion 记录',
        relatedFiles: ['packages/core/src/session.ts'],
        relatedSymbols: ['backgroundTasks'],
      }),
    ])
  })

  it('creates review requirements with diff and code evidence kind', () => {
    const requirements = deriveContextEvidenceRequirements(request('审查刚才的 phase3 diff 有没有问题'))

    expect(requirements).toEqual([
      expect.objectContaining({
        id: 'req_diff_or_relevant_code',
        kind: 'diff_or_relevant_code',
        priority: 'must',
      }),
    ])
  })

  it('keeps chat turns lightweight when no code evidence is implied', () => {
    expect(deriveContextEvidenceRequirements(request('你好'))).toEqual([])
  })
})
