import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildContextBundle } from './orchestrator.js'
import { closeContextStore, openContextStore } from './store.js'
import { makeEvalFact, makeEvalRequest, makeEvalSection, makeEvalStore } from './evals/assertions.js'
import { collectMemoryContext } from './providers/memory-provider.js'
import { collectProjectContext } from './providers/project-provider.js'
import { collectWorkflowContext } from './providers/workflow-provider.js'
import { hashContent } from './providers/shared.js'
import { recordTeamArtifactEvidence } from './team-ledger.js'
import { classifyHarvestCandidate } from './safety.js'
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

  it('does not route small talk or continue-only turns into model harvest', () => {
    for (const [userMessage, reason] of [
      ['hi', 'greeting_or_smalltalk'],
      ['ok', 'no_new_fact'],
      ['继续', 'no_new_fact'],
    ] as const) {
      expect(classifyHarvestCandidate({
        sessionId: 'session_noise',
        runLoopId: `run_${userMessage}`,
        userMessage,
        assistantMessages: [],
        toolEvents: [],
        changedFiles: [],
        createdAt: 1,
      })).toEqual({ action: 'skip', reason })
    }
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

  it('retrieves a relevant old memory without injecting hundreds of recent memories', async () => {
    const cwd = tempProject()
    const store = await openContextStore({ cwd, now: () => 100_000 })

    for (let index = 0; index < 500; index += 1) {
      await store.saveRawEvidence({
        id: `noise_${index}`,
        sessionId: 'session_a',
        cwd,
        sourceProvider: 'ProductEval',
        kind: 'message',
        content: `Recent unrelated preference ${index}`,
        metadata: { messageId: `noise_${index}` },
        capturedAt: 50_000 + index,
        hash: `hash_noise_${index}`,
      })
      await store.saveFact({
        id: `recent_noise_${index}`,
        kind: 'user_preference',
        scope: 'project',
        content: `Recent unrelated preference ${index}`,
        citations: [{ id: `cit_noise_${index}`, type: 'message', ref: `noise_${index}` }],
        confidence: 0.9,
        freshness: 'recent',
        sourceProvider: 'ProductEval',
        sessionId: 'session_a',
        createdAt: 50_000 + index,
        updatedAt: 50_000 + index,
      })
    }

    await store.saveRawEvidence({
      id: 'release_flow_memory',
      sessionId: 'session_a',
      cwd,
      sourceProvider: 'ProductEval',
      kind: 'message',
      content: '用户要求记住 JDCAGNET 发布流程：修改 package version，commit bump，tag vX.Y.Z，push tag 触发 release workflow。',
      metadata: { messageId: 'release_flow_memory' },
      capturedAt: 1,
      hash: 'hash_release_flow_memory',
    })
    await store.saveFact({
      id: 'release_flow_fact',
      kind: 'workflow_rule',
      scope: 'project',
      content: 'JDCAGNET 发布流程：修改 package version，commit bump，tag vX.Y.Z，push tag 触发 release workflow。',
      citations: [{ id: 'cit_release_flow', type: 'message', ref: 'release_flow_memory' }],
      confidence: 1,
      freshness: 'recent',
      sourceProvider: 'ProductEval',
      sessionId: 'session_a',
      createdAt: 1,
      updatedAt: 1,
    })

    const report = await buildContextBundle(request({
      cwd,
      sessionId: 'session_b',
      userMessage: '我们的发布流程是咋样的',
    }), {
      injectionEnabled: true,
      store,
      providers: [],
      now: () => 100_000,
      id: () => 'ctx_release_retrieval',
    })

    expect(report.renderedPrompt).toContain('JDCAGNET 发布流程')
    expect(report.renderedPrompt).not.toContain('Recent unrelated preference 499')
    expect(report.bundle.sections.map((section) => section.id)).toEqual(['fact_release_flow_fact'])
    expect(report.dropped).toEqual([])
  })

  it('keeps provenance metadata while sharing accepted project facts across sessions', async () => {
    const cwd = tempProject()
    const storeA = await openContextStore({ cwd, now: () => 1_000 })
    await storeA.saveRawEvidence({
      id: 'raw_provenance_rule',
      sessionId: 'session_a',
      cwd,
      sourceProvider: 'ProductEval',
      kind: 'message',
      content: '记住：发布前必须跑 pnpm build。',
      metadata: { messageId: 'session_a/provenance_rule' },
      capturedAt: 1_000,
      hash: 'hash_provenance_rule',
    })
    await storeA.saveFact({
      id: 'project_rule_with_origin',
      kind: 'workflow_rule',
      scope: 'project',
      content: '发布前必须跑 pnpm build。',
      citations: [{ id: 'cit_provenance_rule', type: 'message', ref: 'session_a/provenance_rule' }],
      confidence: 0.95,
      freshness: 'recent',
      sourceProvider: 'ProductEval',
      sessionId: 'session_a',
      origin: {
        projectKey: cwd,
        actor: 'user',
        sessionId: 'session_a',
        messageId: 'session_a/provenance_rule',
      },
      tags: ['release'],
      relatedFiles: ['package.json'],
      relatedSymbols: [],
      relatedTasks: [],
      createdAt: 1_000,
      updatedAt: 1_000,
    })

    const storeB = await openContextStore({ cwd, now: () => 2_000 })
    const facts = await storeB.listAcceptedProjectFacts()

    expect(facts.value).toMatchObject([{
      id: 'project_rule_with_origin',
      sessionId: 'session_a',
      origin: {
        projectKey: cwd,
        actor: 'user',
        sessionId: 'session_a',
        messageId: 'session_a/provenance_rule',
      },
      tags: ['release'],
      relatedFiles: ['package.json'],
    }])
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

  it('answers release-flow questions from cited workflow files automatically', async () => {
    const cwd = tempProject()
    writeProjectFile(cwd, '.github/workflows/release.yml', [
      'name: Release',
      'jobs:',
      '  release:',
      '    steps:',
      '      - run: pnpm install',
      '      - run: pnpm build',
      '      - name: Package desktop app',
      '        run: |',
      '          pnpm package',
      '          pnpm --filter @jdcagnet/vscode-extension package',
    ].join('\n'))
    writeProjectFile(cwd, 'package.json', JSON.stringify({
      scripts: {
        build: 'pnpm -r build',
        package: 'pnpm build && electron-builder --publish never',
      },
    }, null, 2))

    const store = await openContextStore({ cwd, now: () => 1_000 })
    const result = await buildContextBundle(request({
      cwd,
      sessionId: 'session_release_question',
      userMessage: '我们的发布流程是咋样的',
    }), {
      injectionEnabled: true,
      store,
      providers: [{ id: 'workflow', collect: (contextRequest) => collectWorkflowContext(contextRequest) }],
      now: () => 1_000,
      id: () => 'ctx_release_workflow_provider',
    })

    expect(result.renderedPrompt).toContain('.github/workflows/release.yml')
    expect(result.renderedPrompt).toContain('pnpm build')
    expect(result.renderedPrompt).toContain('pnpm package')
    expect(result.renderedPrompt).toContain('pnpm --filter @jdcagnet/vscode-extension package')
    expect(result.bundle.citations.some((citation) => citation.ref === '.github/workflows/release.yml' && citation.hash)).toBe(true)
  })

  it('invalidates changed workflow-file facts and suppresses stale release instructions from injection', async () => {
    const cwd = tempProject()
    const store = await openContextStore({ cwd, now: () => 1_000 })
    const oldContent = 'name: Release\nsteps:\n  - run: pnpm package\n'
    const oldHash = hashContent(oldContent)
    await store.saveRawEvidence({
      id: 'raw_release_workflow_old',
      sessionId: 'session_a',
      cwd,
      sourceProvider: 'WorkflowSignalProvider',
      kind: 'file',
      content: oldContent,
      metadata: { file: '.github/workflows/release.yml' },
      capturedAt: 1_000,
      hash: oldHash,
    })
    await store.saveFact({
      id: 'release_workflow_old_fact',
      kind: 'workflow_rule',
      scope: 'project',
      content: '旧发布流程：只运行 pnpm package。',
      citations: [{ id: 'cit_release_workflow_old', type: 'file', ref: '.github/workflows/release.yml', hash: oldHash }],
      confidence: 0.95,
      freshness: 'recent',
      sourceProvider: 'Harvest:WorkflowRuleDistiller',
      sessionId: 'session_a',
      createdAt: 1_000,
      updatedAt: 1_000,
    })

    const invalidated = await store.invalidateByFileHash('.github/workflows/release.yml', hashContent('name: Release\nsteps:\n  - run: pnpm build\n  - run: pnpm package\n'))
    expect(invalidated.value.invalidatedFacts).toBe(1)
    const staleFacts = await store.queryFacts({ includeStale: true, citationRef: '.github/workflows/release.yml' })
    expect(staleFacts.value[0]).toMatchObject({ id: 'release_workflow_old_fact', freshness: 'stale' })

    const result = await buildContextBundle(request({
      cwd,
      sessionId: 'session_b',
      userMessage: '发布流程是什么',
    }), {
      injectionEnabled: true,
      store,
      providers: [],
      now: () => 2_000,
      id: () => 'ctx_release_stale_suppressed',
    })

    expect(result.renderedPrompt).not.toContain('旧发布流程')
    expect(result.bundle.diagnostics).toContainEqual(expect.objectContaining({
      source: 'ContextRetriever',
      message: expect.stringContaining('release_workflow_old_fact'),
      visibleInPrimaryUi: false,
    }))
  })

  it('reuses Team artifact summaries across same-project sessions without leaking to another project', async () => {
    const cwd = tempProject()
    const otherCwd = tempProject()
    const storeA = await openContextStore({ cwd, now: () => 1_000 })
    await recordTeamArtifactEvidence({
      artifactId: 'report',
      artifactKind: 'artifact',
      artifactType: 'report',
      taskId: 'task_checkout',
      memberId: 'member_api',
      summary: 'Checkout task fixed validation handling and documented regression notes.',
      path: '.team/tasks/task_checkout/artifacts/report.md',
    }, {
      store: storeA,
      cwd,
      sessionId: 'session_team_a',
      teamId: 'team_alpha',
      now: () => 1_000,
    })

    const storeB = await openContextStore({ cwd, now: () => 2_000 })
    const sameProject = await buildContextBundle(request({
      cwd,
      sessionId: 'session_team_b',
      userMessage: 'checkout task 做了什么',
    }), {
      injectionEnabled: true,
      store: storeB,
      providers: [],
      now: () => 2_000,
      id: () => 'ctx_team_cross_session',
    })

    const otherStore = await openContextStore({ cwd: otherCwd, now: () => 2_000 })
    const otherProject = await buildContextBundle(request({
      cwd: otherCwd,
      sessionId: 'session_other',
      userMessage: 'checkout task 做了什么',
    }), {
      injectionEnabled: true,
      store: otherStore,
      providers: [],
      now: () => 2_000,
      id: () => 'ctx_team_other_project',
    })

    expect(sameProject.renderedPrompt).toContain('Checkout task fixed validation handling')
    expect(otherProject.renderedPrompt).not.toContain('Checkout task fixed validation handling')
  })
})

function tempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'jdc-context-product-eval-'))
  dirs.push(dir)
  return dir
}

function writeProjectFile(cwd: string, relativePath: string, content: string): void {
  const filePath = path.join(cwd, relativePath)
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
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
