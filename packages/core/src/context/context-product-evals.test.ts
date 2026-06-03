import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildContextBundle } from './orchestrator.js'
import { closeContextStore, openContextStore } from './store.js'
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
      id: () => 'ctx_perf',
    })

    expect(Date.now() - started).toBeLessThan(220)
    expect(result.renderedPrompt).not.toContain('undefined')
    expect(result.providerHealth[0]).toMatchObject({ id: 'code', status: 'timeout' })
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
    tokenBudget: 2_500,
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
