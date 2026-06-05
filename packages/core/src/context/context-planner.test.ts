import { describe, expect, it } from 'vitest'
import { planContext } from './planner.js'
import type { ContextPlanIntent, ContextRequest, ContextSection } from './types.js'

describe('ContextPlanner', () => {
  it('selects project rules and code context for code_edit turns while suppressing noop diagnostics', () => {
    const request = makeRequest({ mode: 'code_edit', userMessage: '修复 Context Engine 面板 CPU 和记忆问题' })
    const sections = [
      section({ id: 'rule_build', kind: 'memory', title: '项目规则', content: '上线前必须跑 pnpm build', sourceProvider: 'Harvest:MemoryCuratorDistiller', confidence: 0.92 }),
      section({ id: 'code_context_panel', kind: 'relevant_code', title: 'ContextPanel', content: 'packages/ui/src/components/context/ContextPanel.tsx', confidence: 0.9 }),
      section({ id: 'noop_diag', kind: 'diagnostics', title: 'Noop', content: 'model_noop', confidence: 0.8 }),
    ]

    const plan = planContext(request, sections)

    expect(plan.intent).toBe('code_edit')
    expect(plan.relevantSections).toEqual(['rule_build', 'code_context_panel'])
    expect(plan.suppressedSections).toEqual([{ id: 'noop_diag', reason: 'low_salience_diagnostic' }])
  })

  it('keeps runtime error chain for debug turns', () => {
    const request = makeRequest({ mode: 'debug', userMessage: '为什么 ParallelToolExecutor cancelled sibling tool failed' })
    const sections = [
      section({ id: 'runtime_error', kind: 'runtime_state', title: 'Runtime', content: 'Cancelled: sibling tool failed', confidence: 0.9 }),
      section({ id: 'project_profile', kind: 'project_profile', title: 'Project', content: 'JDCAGNET', confidence: 0.85 }),
    ]

    const plan = planContext(request, sections)

    expect(plan.intent).toBe('debug')
    expect(plan.relevantSections).toContain('runtime_error')
  })

  it('keeps runtime error chain for code edits that fix runtime failures', () => {
    const request = makeRequest({ mode: 'code_edit', userMessage: 'Fix the runtime cancellation bug' })
    const sections = [
      section({ id: 'runtime_error', kind: 'runtime_state', title: 'Runtime', content: 'Cancelled: sibling tool failed', confidence: 0.9 }),
    ]

    const plan = planContext(request, sections)

    expect(plan.intent).toBe('code_edit')
    expect(plan.relevantSections).toContain('runtime_error')
  })

  it('infers production chat intents from mixed edit, debug, and review wording', () => {
    const cases: Array<{ userMessage: string; intent: ContextPlanIntent }> = [
      { userMessage: 'Fix the runtime cancellation bug', intent: 'code_edit' },
      { userMessage: '修复这个报错', intent: 'code_edit' },
      { userMessage: 'fix 这个 cancelled 工具报错', intent: 'code_edit' },
      { userMessage: 'review this diff', intent: 'review' },
      { userMessage: '审查这个改动', intent: 'review' },
      { userMessage: '为什么 ParallelToolExecutor cancelled sibling tool failed', intent: 'debug' },
      { userMessage: 'investigate why runtime cancelled sibling tool failed', intent: 'debug' },
    ]

    for (const item of cases) {
      expect(planContext(makeRequest({ mode: 'chat', userMessage: item.userMessage }), []).intent).toBe(item.intent)
    }
  })

  it('keeps user intent sections for task-bearing intents', () => {
    for (const mode of ['chat', 'code_edit', 'debug', 'plan', 'review'] as const) {
      const plan = planContext(makeRequest({ mode, userMessage: 'continue current task' }), [
        section({ id: 'current_goal', kind: 'user_intent', title: 'Current Goal', content: 'Finish Task 4' }),
      ])

      expect(plan.relevantSections).toContain('current_goal')
    }
  })

  it('leaves authority conflict decisions to the conflict resolver', () => {
    const plan = planContext(makeRequest({
      userMessage: '继续修复重试',
      transcriptAlreadyInModel: true,
    }), [
      section({
        id: 'conversation_live',
        kind: 'conversation_state',
        title: 'Conversation state',
        content: 'state summary, not raw transcript',
        freshness: 'live',
        sourceProvider: 'ConversationSignalProvider',
      }),
    ])

    expect(plan.relevantSections).toEqual(['conversation_live'])
    expect(plan.suppressedSections).toEqual([])
  })

  it('does not hard-suppress high-value stale or low-confidence sections', () => {
    const plan = planContext(makeRequest({ mode: 'chat', userMessage: 'continue current task' }), [
      section({ id: 'stale_goal', kind: 'user_intent', title: 'Current Goal', content: 'Finish Task 4', freshness: 'stale', confidence: 0.9 }),
      section({ id: 'low_conf_known_issue', kind: 'memory', title: 'Known Issue', content: 'Context panel can spike CPU', freshness: 'stale', confidence: 0.4 }),
    ])

    expect(plan.relevantSections).toEqual(['stale_goal', 'low_conf_known_issue'])
    expect(plan.suppressedSections).toEqual([])
  })
})

function makeRequest(overrides: Partial<ContextRequest>): ContextRequest {
  return {
    sessionId: 'session_1',
    cwd: '/repo',
    userMessage: '',
    recentMessages: [],
    mode: 'chat',
    model: 'gpt-test',
    runtime: {},
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

function section(overrides: Partial<ContextSection>): ContextSection {
  return {
    id: 'section_1',
    kind: 'memory',
    title: 'Section',
    content: 'content',
    citations: [{ id: `cit_${overrides.id ?? 'section_1'}`, type: 'message', ref: 'session_1/run_1' }],
    priority: 50,
    confidence: 0.9,
    freshness: 'recent',
    sourceProvider: 'test',
    tokenEstimate: 10,
    ...overrides,
  }
}
