import { describe, expect, it } from 'vitest'
import { routeHarvestCandidate } from './harvest-router.js'
import type { HarvestCandidate } from './types.js'

describe('routeHarvestCandidate', () => {
  it('skips empty greetings and small no-op confirmations before model distillation', () => {
    expect(routeHarvestCandidate(candidate({ userMessage: '   ' }))).toEqual({ action: 'skip', reason: 'greeting_or_smalltalk' })
    expect(routeHarvestCandidate(candidate({ userMessage: 'hello' }))).toEqual({ action: 'skip', reason: 'greeting_or_smalltalk' })
    expect(routeHarvestCandidate(candidate({ userMessage: 'ok thanks' }))).toEqual({ action: 'skip', reason: 'no_new_fact' })
  })

  it('skips sensitive content before model distillation', () => {
    const decision = routeHarvestCandidate(candidate({ userMessage: 'Remember api key sk-proj-1234567890abcdef1234567890abcdef for the deploy.' }))

    expect(decision).toEqual({ action: 'skip', reason: 'sensitive_content' })
  })

  it('routes tool failures to runtime distillation', () => {
    const decision = routeHarvestCandidate(candidate({
      userMessage: 'Run the tests and diagnose the failure.',
      toolEvents: [{ id: 'tool_1', name: 'bash', status: 'error', isError: true }],
    }))

    expect(decision.action).toBe('distill_runtime')
    expect(decision.reason).toContain('tool')
  })

  it('routes changed files to project update distillation', () => {
    const decision = routeHarvestCandidate(candidate({
      userMessage: 'I updated the context store.',
      changedFiles: ['packages/core/src/context/store.ts'],
    }))

    expect(decision.action).toBe('distill_project_update')
    expect(decision.reason).toContain('changed file')
  })

  it('routes explicit project conventions and memory requests to memory candidate distillation', () => {
    expect(routeHarvestCandidate(candidate({ userMessage: 'Remember: this project always runs vitest with --no-file-parallelism.' })).action).toBe('distill_memory_candidate')
    expect(routeHarvestCandidate(candidate({ userMessage: 'Project convention: context facts must cite stored evidence.' })).action).toBe('distill_memory_candidate')
  })

  it('routes goals constraints and substantive non-keyword turns to model distillation', () => {
    expect(routeHarvestCandidate(candidate({ userMessage: 'The goal is to keep harvest asynchronous after assistant completion.' })).action).toBe('distill_conversation')
    expect(routeHarvestCandidate(candidate({ userMessage: 'Investigate why the context bundle drops runtime diagnostics.' })).action).toBe('distill_conversation')
  })

  it('only skips final fallback short non-signal text as no_new_fact', () => {
    expect(routeHarvestCandidate(candidate({ userMessage: 'later' }))).toEqual({ action: 'skip', reason: 'no_new_fact' })
    expect(routeHarvestCandidate(candidate({ userMessage: 'use scheduler please' }))).toEqual({ action: 'distill_conversation', reason: expect.stringContaining('substantive') })
  })
})

function candidate(overrides: Partial<HarvestCandidate> = {}): HarvestCandidate {
  return {
    sessionId: 'session_1',
    runLoopId: 'run_1',
    userMessage: 'Remember that context harvest uses the scheduler.',
    assistantMessages: [
      { id: 'assistant_1', role: 'assistant', content: [{ type: 'text', text: 'Done.' }], timestamp: 2 },
    ],
    toolEvents: [],
    changedFiles: [],
    createdAt: 1,
    ...overrides,
  }
}
