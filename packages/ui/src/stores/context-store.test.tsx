import type { ConstraintObservabilitySnapshot, ContextInspectPayload, ContextRefreshPayload, MemorySearchPayload } from '@jdcagnet/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useContextStore, type ContextProviderHealth, type ContextRejectedMemoryReview } from './context-store'

function installInvoke(result: unknown | ((channel: string, input?: unknown) => unknown)) {
  const invoke = vi.fn().mockImplementation(async (channel: string, input?: unknown) => (
    typeof result === 'function' ? result(channel, input) : result
  ))
  Object.defineProperty(globalThis, 'window', {
    value: { electronAPI: { invoke } },
    configurable: true,
  })
  return invoke
}

const inspectPayload: ContextInspectPayload = {
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
  acceptedProjectFacts: [],
  droppedSections: [],
  providerHealth: [
    { id: 'code', status: 'stale', updatedAt: 1_700_000_000_100 },
  ] as ContextInspectPayload['providerHealth'],
  providerTimings: [],
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
    summary: { queued: 0, classified: 0, distilling: 0, validating: 0, accepted: 0, rejected: 0, skipped: 1, failed: 0, pending_review: 0 },
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
  schemaInfo: { version: 1, dbPath: '/tmp/context.db' },
}

const acceptedMemoryPayload: MemorySearchPayload = {
  status: 'available',
  searchedAt: 1_700_000_000_800,
  query: { limit: 50 },
  results: [
    {
      id: 'fact-1',
      kind: 'workflow_hint',
      scope: 'project',
      content: 'Use project-local context persistence.',
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

const rejectedMemoryReview = inspectPayload.memoryReview

const refreshPayload: ContextRefreshPayload = {
  status: 'refreshed',
  refreshedAt: 1_700_000_001_000,
  requestedProviders: ['code'],
  bundle: inspectPayload.bundle!,
  providerHealth: [
    {
      id: 'code',
      status: 'fresh',
      updatedAt: 1_700_000_001_000,
    },
  ],
  providerTimings: [],
  diagnostics: [],
}

const constraintPayload: ConstraintObservabilitySnapshot = {
  status: 'idle',
  inspectedAt: 1_700_000_001_000,
  cwd: '/repo',
  summary: { primary: '约束状态正常', secondary: '没有未处理的阻塞、证据缺口或验证缺口。' },
  evidence: { status: 'not_required', missing: [] },
  blockedActions: [],
  verification: { status: 'not_required', changedFiles: [], requirements: [], commands: [] },
  contextHealth: { status: 'available', providerCount: 0, unhealthyProviderCount: 0, diagnostics: [] },
  policyEvents: [],
}

describe('context store', () => {
  beforeEach(() => {
    useContextStore.getState().reset()
    vi.restoreAllMocks()
  })

  it('loads inspect payload and exposes derived inspectability slices', async () => {
    const invoke = installInvoke(inspectPayload)

    await useContextStore.getState().loadInspect({ sessionId: 'sess-1' })

    expect(invoke).toHaveBeenCalledWith('context:inspect', { sessionId: 'sess-1' })
    const state = useContextStore.getState()
    expect(state.inspect.data?.bundle?.sections[0]?.tokenCost.tokenEstimate).toBe(42)
    expect(state.harvest.data?.summary.skipped).toBe(1)
    expect(state.memoryReview.data?.rejected[0]?.rejectionReason).toBe('Missing citations')
    expect(state.providerHealth.data?.[0]?.status).toBe('stale')
  })

  it('loads project context from inspect accepted memory and cached provider health without refresh or renderer reindex', async () => {
    const cachedProviderHealth: ContextProviderHealth = [
      {
        id: 'code',
        status: 'cached',
        updatedAt: 1_700_000_001_100,
        progress: { scanned: 12, total: 20, label: 'Cached code graph' },
        backgroundJob: { id: 'reindex-1', status: 'running', startedAt: 1_700_000_001_000 },
      },
    ]
    const invoke = installInvoke((channel: string) => {
      if (channel === 'context:inspect') return inspectPayload
      if (channel === 'context:memory:list') return acceptedMemoryPayload
      if (channel === 'context:providers:health') return cachedProviderHealth
      if (channel === 'constraint:inspect') return constraintPayload
      throw new Error(`unexpected channel ${channel}`)
    })

    await useContextStore.getState().loadProjectContext({ sessionId: 'sess-1' })

    expect(invoke).toHaveBeenCalledWith('context:inspect', { sessionId: 'sess-1' })
    expect(invoke).toHaveBeenCalledWith('context:memory:list', { limit: 50, sessionId: 'sess-1' })
    expect(invoke).toHaveBeenCalledWith('context:providers:health', expect.objectContaining({ sessionId: 'sess-1' }))
    expect(invoke).not.toHaveBeenCalledWith('context:refresh', expect.anything())
    expect(invoke).not.toHaveBeenCalledWith('context:refresh', expect.objectContaining({ reindex: true }))
    const state = useContextStore.getState()
    expect(state.inspect.data?.bundle?.id).toBe('bundle-1')
    expect(state.harvest.data?.summary.skipped).toBe(1)
    expect(state.memoryReview.data?.accepted?.results[0]?.content).toBe('Use project-local context persistence.')
    expect(state.memoryReview.data?.rejected[0]?.rejectionReason).toBe('Missing citations')
    expect(state.providerHealth.data).toEqual(cachedProviderHealth)
  })

  it('loads constraint inspection with project context', async () => {
    const invoke = installInvoke((channel: string) => {
      if (channel === 'context:inspect') return inspectPayload
      if (channel === 'context:memory:list') return { results: [] }
      if (channel === 'context:providers:health') return []
      if (channel === 'constraint:inspect') {
        return {
          status: 'needs_verification',
          inspectedAt: 1_700_000_000_000,
          cwd: '/repo',
          summary: { primary: '修改等待验证', secondary: '1 个文件需要验证。' },
          evidence: { status: 'not_required', missing: [] },
          blockedActions: [],
          verification: {
            status: 'pending',
            changedFiles: [{ filePath: 'src/app.ts', changedByToolUseId: 'edit_1', changedAt: 1, status: 'pending', updatedAt: 1 }],
            requirements: [],
            commands: [],
          },
          contextHealth: { status: 'available', latestBundleId: 'ctx_1', providerCount: 0, unhealthyProviderCount: 0, diagnostics: [] },
          policyEvents: [],
        }
      }
      throw new Error(`unexpected channel ${channel}`)
    })

    await useContextStore.getState().loadProjectContext({ sessionId: 'sess-1' })

    expect(invoke).toHaveBeenCalledWith('constraint:inspect', { sessionId: 'sess-1' })
    expect(useContextStore.getState().constraint.data?.status).toBe('needs_verification')
  })

  it('does not let stale constraint inspect results overwrite the active session', async () => {
    const sessionAConstraint = deferred<any>()
    const invoke = installInvoke((channel: string, input?: unknown) => {
      const sessionId = (input as any)?.sessionId
      if (channel === 'context:inspect') return { ...inspectPayload, inspectedAt: sessionId === 'session_b' ? 2 : 1 }
      if (channel === 'context:memory:list') return { results: [] }
      if (channel === 'context:providers:health') return []
      if (channel === 'constraint:inspect' && sessionId === 'session_a') return sessionAConstraint.promise
      if (channel === 'constraint:inspect' && sessionId === 'session_b') {
        return {
          status: 'verified',
          inspectedAt: 2,
          cwd: '/repo',
          summary: { primary: '修改已验证', secondary: '当前已记录覆盖修改的验证。' },
          evidence: { status: 'not_required', missing: [] },
          blockedActions: [],
          verification: { status: 'passed', changedFiles: [], requirements: [], commands: [] },
          contextHealth: { status: 'available', providerCount: 0, unhealthyProviderCount: 0, diagnostics: [] },
          policyEvents: [],
        }
      }
      return null
    })

    const loadA = useContextStore.getState().loadProjectContext({ sessionId: 'session_a' })
    await useContextStore.getState().loadProjectContext({ sessionId: 'session_b' })
    sessionAConstraint.resolve({
      status: 'blocked',
      inspectedAt: 1,
      cwd: '/repo',
      summary: { primary: '有操作被约束拦截', secondary: '旧会话结果' },
      evidence: { status: 'not_required', missing: [] },
      blockedActions: [],
      verification: { status: 'not_required', changedFiles: [], requirements: [], commands: [] },
      contextHealth: { status: 'available', providerCount: 0, unhealthyProviderCount: 0, diagnostics: [] },
      policyEvents: [],
    })
    await loadA

    expect(invoke).toHaveBeenCalledWith('constraint:inspect', { sessionId: 'session_b' })
    expect(useContextStore.getState().constraint.data?.status).toBe('verified')
  })

  it('keeps inspect data when accepted memory and provider health fail during project context load', async () => {
    installInvoke((channel: string) => {
      if (channel === 'context:inspect') return inspectPayload
      if (channel === 'context:memory:list') throw new Error('memory unavailable')
      if (channel === 'context:providers:health') throw new Error('health unavailable')
      throw new Error(`unexpected channel ${channel}`)
    })

    await useContextStore.getState().loadProjectContext({ sessionId: 'sess-1' })

    const state = useContextStore.getState()
    expect(state.inspect.data?.bundle?.id).toBe('bundle-1')
    expect(state.inspect.error).toBeNull()
    expect(state.harvest.data?.summary.skipped).toBe(1)
    expect(state.harvest.error).toBeNull()
    expect(state.memoryReview.data?.accepted).toBeNull()
    expect(state.memoryReview.data?.rejected[0]?.id).toBe('candidate-1')
    expect(state.memoryReview.error).toBe('memory unavailable')
    expect(state.providerHealth.data).toEqual(inspectPayload.providerHealth)
    expect(state.providerHealth.error).toBe('health unavailable')
  })

  it('preserves existing provider health when project context health fails without inspect fallback', async () => {
    const cachedProviderHealth: ContextProviderHealth = [{ id: 'code', status: 'cached', updatedAt: 1_700_000_002_000 }]
    useContextStore.setState({
      providerHealth: { data: cachedProviderHealth, loading: false, error: null, loadedAt: 1 },
    })
    installInvoke((channel: string) => {
      if (channel === 'context:inspect') return { ...inspectPayload, providerHealth: [] }
      if (channel === 'context:memory:list') return acceptedMemoryPayload
      if (channel === 'context:providers:health') throw new Error('cached health unavailable')
      throw new Error(`unexpected channel ${channel}`)
    })

    await useContextStore.getState().loadProjectContext({ sessionId: 'sess-1' })

    const state = useContextStore.getState()
    expect(state.inspect.data?.bundle?.id).toBe('bundle-1')
    expect(state.providerHealth.data).toEqual(cachedProviderHealth)
    expect(state.providerHealth.loading).toBe(false)
    expect(state.providerHealth.error).toBe('cached health unavailable')
  })

  it('ignores stale inspect responses when a newer session request resolves first', async () => {
    const sessionA = deferred<ContextInspectPayload>()
    const sessionB = deferred<ContextInspectPayload>()
    const sessionAPayload = inspectForSession('session_a', 'bundle-a')
    const sessionBPayload = inspectForSession('session_b', 'bundle-b')
    installInvoke((channel: string, input?: unknown) => {
      if (channel !== 'context:inspect') throw new Error(`unexpected channel ${channel}`)
      return (input as any)?.sessionId === 'session_a' ? sessionA.promise : sessionB.promise
    })

    const loadA = useContextStore.getState().loadInspect({ sessionId: 'session_a' })
    const loadB = useContextStore.getState().loadInspect({ sessionId: 'session_b' })

    sessionB.resolve(sessionBPayload)
    await loadB
    expect(useContextStore.getState().inspect.data?.bundle?.id).toBe('bundle-b')

    sessionA.resolve(sessionAPayload)
    await loadA
    expect(useContextStore.getState().inspect.data?.bundle?.id).toBe('bundle-b')
    expect(useContextStore.getState().harvest.data?.jobs[0]?.sessionId).toBe('session_b')
  })

  it('ignores stale project context responses after switching sessions', async () => {
    const sessionAInspect = deferred<ContextInspectPayload>()
    const sessionBInspect = deferred<ContextInspectPayload>()
    const sessionAMemory = deferred<MemorySearchPayload>()
    const sessionBMemory = deferred<MemorySearchPayload>()
    const sessionAHealth = deferred<ContextProviderHealth>()
    const sessionBHealth = deferred<ContextProviderHealth>()
    installInvoke((channel: string, input?: unknown) => {
      const sessionId = (input as any)?.sessionId
      if (channel === 'context:inspect') return sessionId === 'session_a' ? sessionAInspect.promise : sessionBInspect.promise
      if (channel === 'context:memory:list') return sessionId === 'session_a' ? sessionAMemory.promise : sessionBMemory.promise
      if (channel === 'context:providers:health') return sessionId === 'session_a' ? sessionAHealth.promise : sessionBHealth.promise
      throw new Error(`unexpected channel ${channel}`)
    })

    const loadA = useContextStore.getState().loadProjectContext({ sessionId: 'session_a' })
    const loadB = useContextStore.getState().loadProjectContext({ sessionId: 'session_b' })

    sessionBInspect.resolve(inspectForSession('session_b', 'bundle-b'))
    sessionBMemory.resolve(memoryForSession('session_b', 'session-b-fact', 'Project memory from session B.'))
    sessionBHealth.resolve([{ id: 'code', status: 'fresh', updatedAt: 1_700_000_004_000 }])
    await loadB

    expect(useContextStore.getState().inspect.data?.bundle?.id).toBe('bundle-b')
    expect(useContextStore.getState().memoryReview.data?.accepted?.results[0]?.id).toBe('session-b-fact')
    expect(useContextStore.getState().providerHealth.data?.[0]?.status).toBe('fresh')

    sessionAInspect.resolve(inspectForSession('session_a', 'bundle-a'))
    sessionAMemory.resolve(memoryForSession('session_a', 'session-a-fact', 'Stale project memory from session A.'))
    sessionAHealth.resolve([{ id: 'code', status: 'stale', updatedAt: 1_700_000_003_000 }])
    await loadA

    expect(useContextStore.getState().inspect.data?.bundle?.id).toBe('bundle-b')
    expect(useContextStore.getState().harvest.data?.jobs[0]?.sessionId).toBe('session_b')
    expect(useContextStore.getState().memoryReview.data?.accepted?.results[0]?.id).toBe('session-b-fact')
    expect(useContextStore.getState().providerHealth.data?.[0]?.status).toBe('fresh')
  })

  it('ignores stale refresh responses after inspect switches to a newer session', async () => {
    const sessionARefresh = deferred<ContextRefreshPayload>()
    const sessionBInspect = deferred<ContextInspectPayload>()
    installInvoke((channel: string) => {
      if (channel === 'context:refresh') return sessionARefresh.promise
      if (channel === 'context:inspect') return sessionBInspect.promise
      throw new Error(`unexpected channel ${channel}`)
    })

    const refreshA = useContextStore.getState().refreshProviders({ sessionId: 'session_a', userMessage: 'refresh A providers' })
    const inspectB = useContextStore.getState().loadInspect({ sessionId: 'session_b' })

    sessionBInspect.resolve(inspectForSession('session_b', 'bundle-b'))
    await inspectB
    expect(useContextStore.getState().providerHealth.data?.[0]?.status).toBe('stale')
    expect(useContextStore.getState().refresh.data).toBeNull()

    sessionARefresh.resolve({
      ...refreshPayload,
      providerHealth: [{ id: 'code', status: 'fresh', updatedAt: 1_700_000_002_000 }],
    })
    await refreshA

    expect(useContextStore.getState().providerHealth.data?.[0]?.status).toBe('stale')
    expect(useContextStore.getState().refresh.data).toBeNull()
  })

  it('does not let a slower diagnostics reload overwrite newer provider health in the same session', async () => {
    const diagnosticsInspect = deferred<ContextInspectPayload>()
    const freshProviderHealth: ContextProviderHealth = [{ id: 'code', status: 'fresh', updatedAt: 1_700_000_003_000 }]
    const staleInspectPayload = { ...inspectPayload, providerHealth: [{ id: 'code', status: 'stale', updatedAt: 1_700_000_002_000 }] as ContextInspectPayload['providerHealth'] }
    installInvoke((channel: string) => {
      if (channel === 'context:inspect') return diagnosticsInspect.promise
      if (channel === 'context:providers:health') return freshProviderHealth
      throw new Error(`unexpected channel ${channel}`)
    })

    const inspect = useContextStore.getState().loadInspect({ sessionId: 'sess-1', includeAdvancedDiagnostics: true })
    const health = useContextStore.getState().loadProviderHealth({ sessionId: 'sess-1', userMessage: '读取提供方状态' })

    await health
    expect(useContextStore.getState().providerHealth.data).toEqual(freshProviderHealth)

    diagnosticsInspect.resolve(staleInspectPayload)
    await inspect

    expect(useContextStore.getState().inspect.data?.bundle?.id).toBe('bundle-1')
    expect(useContextStore.getState().providerHealth.data).toEqual(freshProviderHealth)
  })

  it('loads durable accepted memory and rejected candidates through separate contract channels', async () => {
    const invoke = installInvoke((channel: string) => {
      if (channel === 'context:memory:list') return acceptedMemoryPayload
      if (channel === 'context:inspect') return { ...inspectPayload, memoryReview: rejectedMemoryReview }
      throw new Error(`unexpected channel ${channel}`)
    })

    await useContextStore.getState().loadMemoryReview({ sessionId: 'sess-1', includeExpiredRejected: true })

    expect(invoke).toHaveBeenCalledWith('context:memory:list', { limit: 50, sessionId: 'sess-1' })
    expect(invoke).toHaveBeenCalledWith('context:inspect', { sessionId: 'sess-1', includeExpiredRejected: true })
    const state = useContextStore.getState()
    expect(state.memoryReview.data?.accepted?.results[0]?.content).toBe('Use project-local context persistence.')
    expect(state.memoryReview.data?.rejected[0]?.rejectionReason).toBe('Missing citations')
  })

  it('reloads memory review for a switched session without relying on renderer cache', async () => {
    const sessionAAccepted: MemorySearchPayload = {
      ...acceptedMemoryPayload,
      results: [{ ...acceptedMemoryPayload.results[0], id: 'session-a-fact', content: 'Old renderer memory.' }],
    }
    const sessionBAccepted: MemorySearchPayload = {
      ...acceptedMemoryPayload,
      results: [{ ...acceptedMemoryPayload.results[0], id: 'session-b-fact', content: 'Shared project memory after session switch.' }],
    }
    const invoke = installInvoke((channel: string, input?: unknown) => {
      if (channel === 'context:memory:list') {
        return (input as any)?.sessionId === 'session_b' ? sessionBAccepted : sessionAAccepted
      }
      if (channel === 'context:inspect') return { ...inspectPayload, memoryReview: rejectedMemoryReview }
      throw new Error(`unexpected channel ${channel}`)
    })

    await useContextStore.getState().loadMemoryReview({ sessionId: 'session_a' })
    await useContextStore.getState().loadMemoryReview({ sessionId: 'session_b' })

    expect(invoke).toHaveBeenCalledWith('context:memory:list', { limit: 50, sessionId: 'session_b' })
    expect(invoke).toHaveBeenCalledWith('context:inspect', { sessionId: 'session_b' })
    expect(invoke).toHaveBeenCalledTimes(4)
    expect(useContextStore.getState().memoryReview.data?.accepted?.results[0]?.id).toBe('session-b-fact')
  })

  it('preserves accepted memory after candidate review actions refresh rejected rows', async () => {
    installInvoke((channel: string, input?: unknown) => {
      if (channel === 'context:inspect') return inspectPayload
      if (channel === 'context:memory:reject' && (input as any)?.candidateId === 'candidate-1') return { rejected: [] }
      if (channel === 'context:memory:accept' && (input as any)?.candidateId === 'candidate-2') return { rejected: [] }
      throw new Error(`unexpected channel ${channel}`)
    })
    await useContextStore.getState().loadInspect({ sessionId: 'sess-1' })
    useContextStore.setState({
      memoryReview: {
        data: { accepted: acceptedMemoryPayload, rejected: rejectedMemoryReview.rejected },
        loading: false,
        error: null,
        loadedAt: 1,
      },
    })

    await useContextStore.getState().rejectMemoryCandidate('candidate-1', 'sess-1')
    expect(useContextStore.getState().memoryReview.data?.accepted).toEqual(acceptedMemoryPayload)

    useContextStore.setState({
      memoryReview: {
        data: { accepted: acceptedMemoryPayload, rejected: rejectedMemoryReview.rejected },
        loading: false,
        error: null,
        loadedAt: 2,
      },
    })
    await useContextStore.getState().acceptMemoryCandidate('candidate-2', 'sess-1')
    expect(useContextStore.getState().memoryReview.data?.accepted).toEqual(acceptedMemoryPayload)
  })

  it('ignores pending memory review actions after reset clears the active session', async () => {
    const rejectResult = deferred<ContextRejectedMemoryReview>()
    installInvoke((channel: string, input?: unknown) => {
      if (channel === 'context:inspect') return inspectPayload
      if (channel === 'context:memory:reject' && (input as any)?.candidateId === 'candidate-1') return rejectResult.promise
      throw new Error(`unexpected channel ${channel}`)
    })
    await useContextStore.getState().loadInspect({ sessionId: 'sess-1' })

    const pendingReject = useContextStore.getState().rejectMemoryCandidate('candidate-1', 'sess-1')
    useContextStore.getState().reset()
    rejectResult.resolve({ rejected: [] })
    await pendingReject

    expect(useContextStore.getState().memoryReview.data).toBeNull()
  })

  it('records IPC failures as non-throwing request errors', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('ipc down'))
    Object.defineProperty(globalThis, 'window', {
      value: { electronAPI: { invoke } },
      configurable: true,
    })

    await useContextStore.getState().loadInspect({ sessionId: 'sess-1' })

    const state = useContextStore.getState()
    expect(state.inspect.loading).toBe(false)
    expect(state.inspect.error).toBe('ipc down')
    expect(state.inspect.data).toBeNull()
  })

  it('loads provider health through the cached health channel without triggering refresh', async () => {
    const extendedHealth: ContextProviderHealth = [
      {
        id: 'code',
        status: 'indexing',
        updatedAt: 1_700_000_001_100,
        progress: { scanned: 12, total: 20, label: 'Indexing cached code graph' },
        backgroundJob: { id: 'reindex-1', status: 'running', startedAt: 1_700_000_001_000 },
      },
    ]
    const invoke = installInvoke(extendedHealth)

    await useContextStore.getState().loadProviderHealth({ sessionId: 'sess-1', userMessage: 'check cached health' })

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('context:providers:health', { sessionId: 'sess-1', userMessage: 'check cached health' })
    expect(invoke).not.toHaveBeenCalledWith('context:refresh', expect.anything())
    expect(useContextStore.getState().providerHealth.data).toEqual(extendedHealth)
  })

  it('refreshes providers separately from cached inspect loads', async () => {
    const invoke = installInvoke(refreshPayload)

    await useContextStore.getState().refreshProviders({ sessionId: 'sess-1', userMessage: 'refresh providers', providers: ['code'] })

    expect(invoke).toHaveBeenCalledWith('context:refresh', { sessionId: 'sess-1', userMessage: 'refresh providers', providers: ['code'] })
    const state = useContextStore.getState()
    expect(state.refresh.data?.status).toBe('refreshed')
    expect(state.providerHealth.data?.[0]?.status).toBe('fresh')
  })
})

function inspectForSession(sessionId: string, bundleId: string): ContextInspectPayload {
  return {
    ...inspectPayload,
    bundle: inspectPayload.bundle ? { ...inspectPayload.bundle, id: bundleId, sessionId } : null,
    harvestQueue: {
      ...inspectPayload.harvestQueue,
      jobs: inspectPayload.harvestQueue.jobs.map((job) => ({ ...job, sessionId })),
    },
    memoryReview: {
      rejected: inspectPayload.memoryReview.rejected.map((candidate) => ({ ...candidate, sessionId })),
    },
  }
}

function memoryForSession(sessionId: string, id: string, content: string): MemorySearchPayload {
  return {
    ...acceptedMemoryPayload,
    results: acceptedMemoryPayload.results.map((result) => ({
      ...result,
      id,
      content,
      citations: result.citations.map((citation) => ({ ...citation, ref: `${sessionId}/run-1` })),
    })),
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
