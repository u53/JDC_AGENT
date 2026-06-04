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

  it('routes workflow and package file changes to workflow rule distillation', () => {
    expect(routeHarvestCandidate(candidate({
      userMessage: '更新 release workflow',
      changedFiles: ['.github/workflows/release.yml'],
    })).action).toBe('distill_workflow_rule')

    expect(routeHarvestCandidate(candidate({
      userMessage: '更新 package scripts',
      changedFiles: ['package.json'],
    })).action).toBe('distill_workflow_rule')

    expect(routeHarvestCandidate(candidate({
      userMessage: '更新 extension package scripts',
      changedFiles: ['packages/vscode-extension/package.json'],
    })).action).toBe('distill_workflow_rule')
  })

  it('routes assistant project summaries to project update distillation', () => {
    const decision = routeHarvestCandidate(candidate({
      userMessage: '帮我总结一下这个项目整体',
      assistantMessages: [{
        id: 'assistant_project_summary',
        role: 'assistant',
        timestamp: 2,
        content: [{
          type: 'text',
          text: [
            '# 项目整体架构',
            'packages/core 负责 runLoop、JDC Context Engine、工具调度和上下文注入。',
            'packages/electron 负责桌面主进程、IPC 和窗口管理。',
            'packages/ui 负责 React UI、Inspector 和 Context Panel。',
            '常用命令包括 pnpm --filter @jdcagnet/core test 和 pnpm --filter @jdcagnet/core build。',
          ].join('\n'),
        }],
      }],
    }))

    expect(decision).toEqual({
      action: 'distill_project_update',
      reason: expect.stringContaining('assistant project summary'),
    })
  })

  it('routes short confirmation turns when assistant evidence contains a project summary', () => {
    const decision = routeHarvestCandidate(candidate({
      userMessage: '当然，存一下',
      assistantMessages: [{
        id: 'assistant_previous_summary',
        role: 'assistant',
        timestamp: 2,
        content: [{
          type: 'text',
          text: [
            '项目整体架构：packages/core 管理 JDC Context Engine、Session runLoop、harvest 和 tool runner。',
            'packages/electron 管理 IPC、窗口和桌面服务。',
            'packages/ui 管理 React Inspector、Context Panel 和聊天界面。',
          ].join('\n'),
        }],
      }],
    }))

    expect(decision.action).toBe('distill_project_update')
    expect(decision.reason).toContain('confirmation')
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

  it('routes structured Team candidates and skips raw worker chatter', () => {
    expect(routeHarvestCandidate(candidate({
      origin: { projectKey: '/repo', actor: 'team_pm', teamId: 'team_alpha' },
      userMessage: 'Decision: checkout API keeps the existing response envelope.',
    })).action).toBe('distill_team_ledger')

    expect(routeHarvestCandidate(candidate({
      origin: { projectKey: '/repo', actor: 'team_worker', teamId: 'team_alpha', taskId: 'task_checkout' },
      toolEvents: [{ id: 'tool_1', name: 'team_artifact', status: 'complete', action: 'create_artifact', artifactId: 'report' }],
      userMessage: 'Worker completed checkout artifact.',
    })).action).toBe('distill_artifact_summary')

    expect(routeHarvestCandidate(candidate({
      origin: { projectKey: '/repo', actor: 'team_worker', teamId: 'team_alpha', taskId: 'task_checkout' },
      toolEvents: [{ id: 'tool_2', name: 'team_artifact', status: 'complete', action: 'create_issue', issueId: 'ISSUE-001' }],
      userMessage: 'Worker filed QA issue ISSUE-001.',
    })).action).toBe('distill_qa_issue')

    expect(routeHarvestCandidate(candidate({
      origin: { projectKey: '/repo', actor: 'team_worker', teamId: 'team_alpha', taskId: 'task_checkout' },
      userMessage: 'Worker is thinking through the checkout implementation and waiting.',
    }))).toEqual({ action: 'skip', reason: 'no_new_fact' })
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
