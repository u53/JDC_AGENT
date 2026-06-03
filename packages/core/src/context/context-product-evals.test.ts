import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildContextBundle } from './orchestrator.js'
import { closeContextStore, openContextStore } from './store.js'
import { makeEvalFact, makeEvalRequest, makeEvalSection, makeEvalStore } from './evals/assertions.js'
import { collectMemoryContext } from './providers/memory-provider.js'
import { collectProjectContext } from './providers/project-provider.js'
import type { ContextProvider, ContextProviderResult } from './orchestrator.js'
import type { ContextRequest } from './types.js'

const dirs: string[] = []

afterEach(async () => {
  for (const dir of dirs) await closeContextStore({ cwd: dir })
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

describe('JDC Context Engine product evals', () => {
  it('reuses accepted project convention across sessions after reopening the store', async () => {
    const cwd = tempProject()
    const storeA = await openContextStore({ cwd, now: () => 1_000 })
    await storeA.saveRawEvidence({
      id: 'raw_user_rule',
      sessionId: 'session_a',
      cwd,
      sourceProvider: 'ProductEval',
      kind: 'message',
      content: '记住这个项目约定：上线前必须跑 pnpm build',
      metadata: { messageId: 'session_a/run_1' },
      capturedAt: 1_000,
      hash: 'hash_user_rule',
    })
    const save = await storeA.saveFact({
      id: 'project_convention_build',
      kind: 'project_convention',
      scope: 'project',
      content: '上线前必须跑 pnpm build',
      citations: [{ id: 'cit_user_rule', type: 'message', ref: 'session_a/run_1' }],
      confidence: 0.91,
      freshness: 'recent',
      sourceProvider: 'Harvest:MemoryCuratorDistiller',
      sessionId: 'session_a',
      createdAt: 1_000,
      updatedAt: 1_000,
    })
    expect(save.ok).toBe(true)

    const storeB = await openContextStore({ cwd, now: () => 2_000 })
    const result = await buildContextBundle(request({ cwd, sessionId: 'session_b', userMessage: '帮我改一下 UI 文案' }), {
      store: storeB,
      providers: [],
      id: () => 'ctx_cross_session',
    })

    expect(result.renderedPrompt).toContain('上线前必须跑 pnpm build')
  })

  it('does not render model_noop as primary durable context', async () => {
    const cwd = tempProject()
    const store = await openContextStore({ cwd, now: () => 1_000 })
    await store.rejectCandidate(
      { action: 'skip', reason: 'model_noop' },
      'Harvest model skipped durable storage: model_noop',
      {
        id: 'noop_1',
        sessionId: 'session_a',
        createdAt: 1_000,
        validationErrors: ['model_noop'],
        status: 'rejected',
        visibleInPrimaryUi: false,
      },
    )

    const result = await buildContextBundle(request({ cwd, sessionId: 'session_b', userMessage: '继续' }), {
      store,
      providers: [],
      id: () => 'ctx_noop',
    })

    expect(result.bundle.sections).toEqual([])
    expect(result.renderedPrompt).not.toContain('model_noop')
  })

  it('returns foreground context quickly when a provider is slow', async () => {
    const cwd = tempProject()
    const store = await openContextStore({ cwd, now: () => 1_000 })
    const started = Date.now()
    const result = await buildContextBundle(request({ cwd, userMessage: '修复性能' }), {
      store,
      providers: [slowProvider()],
      providerTimeoutMs: 80,
      id: () => 'ctx_perf',
    })

    expect(Date.now() - started).toBeLessThan(220)
    expect(result.renderedPrompt).not.toContain('undefined')
    expect(result.providerHealth[0]).toMatchObject({ id: 'code', status: 'timeout' })
  })

  it('keeps a large relevant project primer when no explicit cap is configured', async () => {
    const primer = makeEvalSection({
      id: 'large_project_primer',
      kind: 'project_profile',
      title: 'Large Project Primer',
      content: 'JDCAGNET 项目背景 '.repeat(3_000),
      tokenEstimate: 15_000,
      priority: 100,
      sourceProvider: 'ProjectSignalProvider',
    })

    const result = await buildContextBundle(makeEvalRequest({ tokenBudget: undefined, userMessage: '解释 JDCAGNET 项目背景' }), {
      injectionEnabled: true,
      store: makeEvalStore(),
      providers: [{
        id: 'project',
        collect: async () => ({ evidence: [], sections: [primer], diagnostics: [], health: { id: 'project', status: 'enabled', updatedAt: 1 } }),
      }],
      id: () => 'ctx_large_project_primer',
    })

    expect(result.renderedPrompt).toContain('JDCAGNET 项目背景')
    expect(result.bundle.budget.droppedTokens).toBe(0)
    expect(result.dropped).toEqual([])
  })

  it('injects accepted project memory through the memory provider', async () => {
    const store = makeEvalStore({
      facts: [makeEvalFact({
        id: 'release_rule',
        kind: 'workflow_rule',
        content: '发布前必须运行 pnpm build。',
        confidence: 0.95,
      })],
    })

    const memory = await collectMemoryContext(makeEvalRequest({ userMessage: '发布流程是什么' }), { store })

    expect(memory.sections.map((section) => section.content).join('\n')).toContain('pnpm build')
  })

  it('preserves project documentation content beyond the first three non-empty lines', async () => {
    const cwd = tempProject()
    writeFileSync(path.join(cwd, 'JDCAGNET.md'), [
      '# JDCAGNET',
      '第一行简介。',
      '第二行简介。',
      '第三行简介。',
      '',
      '## 发布流程',
      '生产发布前必须运行 pnpm build 并确认 Context Engine eval 通过。',
    ].join('\n'))

    const project = await collectProjectContext(makeEvalRequest({ cwd, userMessage: '发布流程是什么' }))

    expect(project.sections[0]?.content).toContain('发布流程')
    expect(project.sections[0]?.content).toContain('pnpm build')
    expect(project.sections[0]?.content).toContain('Context Engine eval')
  })
})

function tempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'jdc-context-product-eval-'))
  dirs.push(dir)
  return dir
}

function request(overrides: Partial<ContextRequest>): ContextRequest {
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

function slowProvider(): ContextProvider {
  return {
    id: 'code',
    collect: async (): Promise<ContextProviderResult> => {
      await new Promise((resolve) => setTimeout(resolve, 250))
      return {
        evidence: [],
        sections: [],
        diagnostics: [],
        health: { id: 'code', status: 'enabled', updatedAt: 1_000 },
      }
    },
  }
}
