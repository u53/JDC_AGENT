import type { ContextInspectPayload, MemorySearchPayload } from '@jdcagnet/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { useContextStore, type ContextProviderHealth } from '../../stores/context-store'
import { ContextCurrentPanel } from './ContextCurrentPanel'
import { ContextFactsPanel } from './ContextFactsPanel'
import { ContextInspectPanel } from './ContextInspectPanel'
import { ContextPanelLayout } from './ContextPanelLayout'
import { HarvestQueuePanel } from './HarvestQueuePanel'
import { MemoryReviewPanel } from './MemoryReviewPanel'
import { ProviderHealthPanel } from './ProviderHealthPanel'

const payload: ContextInspectPayload = {
  status: 'available',
  inspectedAt: 1_700_000_000_000,
  bundle: {
    id: 'bundle-1',
    sessionId: 'sess-1',
    requestHash: 'hash-1',
    createdAt: 1_700_000_000_000,
    sections: [
      {
        id: 'section-1',
        kind: 'relevant_code',
        title: 'Relevant code',
        content: 'Use the context panel.',
        citations: [{ id: 'cite-1', type: 'file', ref: 'src/app.ts', line: 12 }],
        priority: 10,
        confidence: 0.92,
        freshness: 'live',
        sourceProvider: 'code',
        tokenEstimate: 42,
        tokenCost: { tokenEstimate: 42, source: 'estimator', droppedTokens: 3 },
      },
    ],
    citations: [{ id: 'cite-1', type: 'file', ref: 'src/app.ts', line: 12 }],
    diagnostics: [],
    budget: { maxTokens: 1000, usedTokens: 42, droppedTokens: 3 },
  },
  acceptedProjectFacts: [
    {
      id: 'project-rule-1',
      kind: 'workflow_rule',
      scope: 'project',
      content: '发布前运行 pnpm build。',
      citations: [{ id: 'cite-fact-1', type: 'message', ref: 'sess-1/run-accepted', timestamp: 1_700_000_000_000 }],
      confidence: 0.91,
      freshness: 'cached',
      sourceProvider: 'harvest',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_100,
    },
  ],
  droppedSections: [],
  providerHealth: [
    { id: 'code', status: 'enabled', updatedAt: 1_700_000_000_000 },
    { id: 'memory', status: 'stale', updatedAt: 1_700_000_000_100 },
    { id: 'git', status: 'failed', updatedAt: 1_700_000_000_200, diagnostic: { id: 'diag-1', level: 'error', source: 'git', message: 'git unavailable', createdAt: 1_700_000_000_200 } },
    { id: 'ide', status: 'rate_limited', updatedAt: 1_700_000_000_300 },
  ],
  providerTimings: [
    { id: 'code', startedAt: 1_700_000_000_000, completedAt: 1_700_000_000_010, durationMs: 10, status: 'enabled' },
  ],
  harvestQueue: {
    jobs: [
      {
        id: 'job-1',
        sessionId: 'sess-1',
        runLoopId: 'run-1',
        status: 'skipped',
        candidate: {
          sessionId: 'sess-1',
          runLoopId: 'run-1',
          userMessage: 'hello',
          assistantMessages: [],
          toolEvents: [],
          changedFiles: [],
          createdAt: 1_700_000_000_000,
        },
        decision: { action: 'skip', reason: 'no_new_fact' },
        modelBinding: {
          sessionId: 'sess-1',
          providerProtocol: 'openai-chat',
          modelId: 'gpt-test',
          modelConfig: { model: 'gpt-test', maxTokens: 1000 },
        },
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_500,
      },
    ],
    summary: { queued: 0, classified: 0, distilling: 0, validating: 0, accepted: 2, rejected: 1, skipped: 1, failed: 1, pending_review: 0 },
  },
  memoryReview: {
    rejected: [
      {
        id: 'candidate-1',
        sessionId: 'sess-1',
        status: 'rejected',
        candidate: { content: 'uncited fact' },
        rejectionReason: 'Missing citations',
        validationErrors: ['citation required'],
        createdAt: 1_700_000_000_000,
        expiresAt: 1_700_086_400_000,
      },
    ],
  },
  diagnostics: [],
  schemaInfo: { version: 3, dbPath: '/repo/.jdcagnet/context-engine/context.db' },
}

const acceptedMemory: MemorySearchPayload = {
  status: 'available',
  searchedAt: 1_700_000_001_000,
  query: { limit: 50 },
  results: [
    {
      id: 'fact-1',
      kind: 'workflow_hint',
      scope: 'project',
      content: 'Accepted facts are durable only after citation validation.',
      citations: [{ id: 'cite-memory-1', type: 'message', ref: 'sess-1/run-1', timestamp: 1_700_000_000_000 }],
      confidence: 0.87,
      freshness: 'cached',
      sourceProvider: 'harvest',
      createdAt: 1_700_000_000_500,
      updatedAt: 1_700_000_000_700,
      expiresAt: 1_700_086_400_000,
    },
  ],
  diagnostics: [],
}

const extendedProviders: ContextProviderHealth = [
  {
    id: 'code',
    status: 'indexing',
    updatedAt: 1_700_000_000_400,
    progress: { scanned: 12, total: 20, label: 'Indexing cached code graph', fromSnapshot: true },
    backgroundJob: { id: 'reindex-1', status: 'running', queuedAt: 1_700_000_000_350, startedAt: 1_700_000_000_360 },
  },
  { id: 'memory', status: 'cached', updatedAt: 1_700_000_000_500 },
  { id: 'git', status: 'timeout', updatedAt: 1_700_000_000_600 },
  { id: 'project', status: 'not_indexed', updatedAt: 1_700_000_000_700 },
]
describe('context inspectability panels', () => {
  beforeEach(() => {
    useContextStore.getState().reset()
  })

  it('renders a Chinese-first automatic observability shell without primary debug controls', () => {
    const html = renderToStaticMarkup(
      <ContextPanelLayout
        sessionId="sess-1"
        activeTab="status"
        onTabChange={() => {}}
        inspect={request(payload)}
        harvest={request(payload.harvestQueue)}
        memoryReview={request({ accepted: acceptedMemory, rejected: payload.memoryReview.rejected })}
        providerHealth={request(extendedProviders)}
        refresh={request(null)}
        onReloadDiagnostics={() => {}}
        onReindexCode={() => {}}
        onReadProviderStatus={() => {}}
      />,
    )

    expect(html).toContain('JDC 上下文引擎')
    expect(html).toContain('项目理解')
    expect(html).toContain('项目记忆')
    expect(html).toContain('当前上下文')
    expect(html).toContain('团队沉淀')
    expect(html).toContain('引擎状态')
    expect(html).toContain('context-panel-scroll')
    expect(html).not.toContain('高级诊断</button>')
    expect(html).not.toContain('Inspect')
    expect(html).not.toContain('Harvest')
    expect(html).not.toContain('Memory')
    expect(html).not.toContain('Health')
    expect(html).not.toContain('Read cached view')
    expect(html).not.toContain('Read cached health')
    expect(html).not.toContain('重新读取诊断')
    expect(html).not.toContain('后台重建代码索引')
    expect(html).not.toContain('读取提供方状态')
  })

  it('keeps manual diagnostics and provider controls inside the advanced tab', () => {
    const html = renderToStaticMarkup(
      <ContextPanelLayout
        sessionId="sess-1"
        activeTab="advanced"
        onTabChange={() => {}}
        inspect={request({ ...payload, advancedDiagnostics: { rejected: payload.memoryReview.rejected, diagnostics: payload.diagnostics, harvestJobs: payload.harvestQueue.jobs, noop: { rejected: 2, diagnostics: 3, harvestJobs: 4 } } })}
        harvest={request(payload.harvestQueue)}
        memoryReview={request({ accepted: acceptedMemory, rejected: payload.memoryReview.rejected })}
        providerHealth={request(extendedProviders)}
        refresh={request(null)}
        onReloadDiagnostics={() => {}}
        onReindexCode={() => {}}
        onReadProviderStatus={() => {}}
      />,
    )

    expect(html).toContain('重新读取诊断')
    expect(html).toContain('后台重建代码索引')
    expect(html).toContain('读取提供方状态')
    expect(html).toContain('已折叠空结果记录')
    expect(html).toContain('job-1')
    expect(html).toContain('reindex-1')
  })

  it('renders current injected context sections in Chinese with citations and suppressed count', () => {
    const html = renderToStaticMarkup(<ContextCurrentPanel payload={{ ...payload, droppedSections: [{ section: { ...payload.bundle!.sections[0], id: 'dropped-1', title: 'Dropped', content: 'model_noop rejected candidate' }, reason: 'token budget', tokenEstimate: 25 }] }} loading={false} error={null} />)

    expect(html).toContain('Relevant code')
    expect(html).toContain('Use the context panel.')
    expect(html).toContain('本轮注入')
    expect(html).toContain('未注入')
    expect(html).toContain('注入原因')
    expect(html).toContain('相关代码匹配')
    expect(html).toContain('来源')
    expect(html).toContain('置信度')
    expect(html).toContain('新鲜度')
    expect(html).toContain('引用')
    expect(html).toContain('已抑制 1')
    expect(html).toContain('92%')
    expect(html).toContain('实时')
    expect(html).toContain('42 令牌')
    expect(html).not.toContain('tokens')
    expect(html).toContain('src/app.ts:12')
    expect(html).not.toContain('model_noop')
    expect(html).not.toContain('candidate-1')
  })

  it('keeps raw provider and planner diagnostics out of the primary status panel', () => {
    const noisyPayload: ContextInspectPayload = {
      ...payload,
      diagnostics: [
        { id: 'diag-ide', level: 'warning', source: 'IdeSignalProvider', message: 'IDE snapshot is unavailable; IDE provider returned stale degraded context.', createdAt: 1_700_000_000_000 },
      ],
      bundle: payload.bundle
        ? {
            ...payload.bundle,
            diagnostics: [
              { id: 'diag-code', level: 'warning', source: 'ContextProvider:code', message: 'Provider code exceeded context budget; returning degraded context.', createdAt: 1_700_000_000_000 },
              { id: 'diag-planner', level: 'info', source: 'ContextPlanner', message: 'Plan ctx_plan_test inferred debug intent and selected 0/0 context sections.', createdAt: 1_700_000_000_000 },
            ],
          }
        : null,
    }
    const html = renderToStaticMarkup(<ContextInspectPanel payload={noisyPayload} loading={false} error={null} />)

    expect(html).not.toContain('IdeSignalProvider')
    expect(html).not.toContain('Provider code exceeded context budget')
    expect(html).not.toContain('ContextPlanner')
    expect(html).not.toContain('selected 0/0 context sections')
  })

  it('renders accepted project memory facts with Chinese labels', () => {
    const html = renderToStaticMarkup(<ContextFactsPanel acceptedMemory={acceptedMemory} projectFacts={payload.acceptedProjectFacts} loading={false} error={null} />)

    expect(html).toContain('项目记忆')
    expect(html).toContain('Accepted facts are durable only after citation validation.')
    expect(html).toContain('发布前运行 pnpm build。')
    expect(html).toContain('置信度')
    expect(html).toContain('87%')
    expect(html).toContain('sess-1/run-1')
    expect(html).toContain('过期')
  })

  it('keeps accepted project facts visible when accepted memory loading has a partial error', () => {
    const html = renderToStaticMarkup(<ContextFactsPanel acceptedMemory={null} projectFacts={payload.acceptedProjectFacts} loading={false} error="memory unavailable" />)

    expect(html).toContain('发布前运行 pnpm build。')
    expect(html).toContain('部分项目记忆暂不可用')
    expect(html).toContain('memory unavailable')
  })

  it('renders status states in Chinese as isolated from chat', () => {
    const disabledHtml = renderToStaticMarkup(<ContextInspectPanel payload={{ ...payload, status: 'disabled', bundle: null }} loading={false} error={null} />)
    const unavailableHtml = renderToStaticMarkup(<ContextInspectPanel payload={{ ...payload, status: 'unavailable', bundle: null, diagnostics: [{ id: 'diag-1', level: 'error', source: 'JdcContextInspect', message: 'store unavailable', createdAt: 1_700_000_000_000 }] }} loading={false} error={null} />)

    expect(disabledHtml).toContain('上下文引擎已关闭')
    expect(disabledHtml).toContain('聊天继续运行')
    expect(unavailableHtml).toContain('上下文暂不可用')
    expect(unavailableHtml).toContain('store unavailable')
  })

  it('renders harvest queue statuses and skip or rejection reasons in Chinese', () => {
    const html = renderToStaticMarkup(<HarvestQueuePanel queue={payload.harvestQueue} loading={false} error={null} />)

    expect(html).toContain('已接受')
    expect(html).toContain('已跳过')
    expect(html).toContain('已拒绝')
    expect(html).toContain('失败')
    expect(html).toContain('no_new_fact')
    expect(html).toContain('gpt-test')
    expect(html).toContain('持久事实')
    expect(html).toContain('未报告')
    expect(html).toContain('验证')
    expect(html).toContain('引用/置信度/过期')
  })

  it('renders accepted durable memory records and rejected validation failures in Chinese', () => {
    const html = renderToStaticMarkup(<MemoryReviewPanel review={{ accepted: acceptedMemory, rejected: payload.memoryReview.rejected }} loading={false} error={null} />)

    expect(html).toContain('已接受记忆')
    expect(html).toContain('Accepted facts are durable only after citation validation.')
    expect(html).toContain('87%')
    expect(html).toContain('sess-1/run-1')
    expect(html).toContain('过期')
    expect(html).toContain('candidate-1')
    expect(html).toContain('已拒绝')
    expect(html).toContain('Missing citations')
    expect(html).toContain('citation required')
  })

  it('renders provider health enabled stale failed and rate limited states in Chinese', () => {
    const html = renderToStaticMarkup(<ProviderHealthPanel providers={payload.providerHealth} timings={payload.providerTimings} loading={false} error={null} />)

    expect(html).toContain('已启用')
    expect(html).toContain('过期')
    expect(html).toContain('失败')
    expect(html).toContain('限流')
    expect(html).toContain('git unavailable')
  })

  it('renders provider health cached indexing timeout and not indexed states with background progress in Chinese', () => {
    const html = renderToStaticMarkup(<ProviderHealthPanel providers={extendedProviders} timings={[]} loading={false} error={null} />)

    expect(html).toContain('索引中')
    expect(html).toContain('已缓存')
    expect(html).toContain('超时')
    expect(html).toContain('未索引')
    expect(html).toContain('12/20')
    expect(html).toContain('60%')
    expect(html).toContain('来自快照')
    expect(html).toContain('reindex-1')
    expect(html).toContain('运行中')
  })
})

function request<T>(data: T) {
  return { data, loading: false, error: null, loadedAt: 1 }
}
