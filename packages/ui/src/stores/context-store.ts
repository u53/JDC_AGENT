import type { ConstraintObservabilitySnapshot, ContextInspectPayload, ContextRefreshInput, ContextRefreshPayload, MemorySearchPayload } from '@jdcagnet/core'
import { create } from 'zustand'

export interface ContextInspectInput {
  sessionId?: string
  bundleId?: string
  includeExpiredRejected?: boolean
  includeAdvancedDiagnostics?: boolean
}

export interface ContextProjectContextInput {
  sessionId: string
}

export type ContextHarvestQueue = ContextInspectPayload['harvestQueue']
export type ContextRejectedMemoryReview = ContextInspectPayload['memoryReview']
export type ContextAcceptedMemoryReview = MemorySearchPayload
export type ContextMemoryReview = {
  accepted: ContextAcceptedMemoryReview | null
  rejected: ContextRejectedMemoryReview['rejected']
}
export type ContextProviderDisplayStatus = ContextInspectPayload['providerHealth'][number]['status']
export type ContextProviderProgress = {
  scanned?: number
  completed?: number
  total?: number
  percent?: number
  label?: string
  message?: string
  fromSnapshot?: boolean
}
export type ContextProviderBackgroundJob = {
  id?: string
  status?: string
  queuedAt?: number
  startedAt?: number
  updatedAt?: number
  completedAt?: number
  message?: string
}
export type ContextProviderHealthItem = Omit<ContextInspectPayload['providerHealth'][number], 'status' | 'progress' | 'backgroundJob'> & {
  status: ContextProviderDisplayStatus
  progress?: ContextProviderProgress
  backgroundJob?: ContextProviderBackgroundJob
}
export type ContextProviderHealth = ContextProviderHealthItem[]
export type ContextRefreshState = ContextRefreshPayload
export type ConstraintInspectState = ConstraintObservabilitySnapshot

export interface ContextRequestState<T> {
  data: T | null
  loading: boolean
  error: string | null
  loadedAt: number | null
}

interface ContextStoreState {
  inspect: ContextRequestState<ContextInspectPayload>
  harvest: ContextRequestState<ContextHarvestQueue>
  memoryReview: ContextRequestState<ContextMemoryReview>
  providerHealth: ContextRequestState<ContextProviderHealth>
  refresh: ContextRequestState<ContextRefreshState>
  constraint: ContextRequestState<ConstraintInspectState>
  loadProjectContext: (input: ContextProjectContextInput) => Promise<void>
  loadInspect: (input?: ContextInspectInput) => Promise<void>
  loadHarvestQueue: (input?: ContextInspectInput) => Promise<void>
  loadMemoryReview: (input?: ContextInspectInput) => Promise<void>
  loadProviderHealth: (input: ContextRefreshInput) => Promise<void>
  loadConstraintInspect: (input: ContextProjectContextInput) => Promise<void>
  refreshProviders: (input: ContextRefreshInput) => Promise<void>
  acceptMemoryCandidate: (candidateId: string, sessionId: string) => Promise<void>
  rejectMemoryCandidate: (candidateId: string, sessionId: string) => Promise<void>
  reset: () => void
}

const emptyRequest = <T>(): ContextRequestState<T> => ({
  data: null,
  loading: false,
  error: null,
  loadedAt: null,
})

function requestError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function settledError(result: PromiseSettledResult<unknown>): string | null {
  return result.status === 'rejected' ? requestError(result.reason) : null
}

async function invokeContract<T>(channel: string, input?: unknown): Promise<T> {
  const api = window.electronAPI
  if (!api) throw new Error('Electron IPC unavailable')
  return api.invoke(channel, input) as Promise<T>
}

type ContextRequestKey = 'inspect' | 'harvest' | 'memoryReview' | 'providerHealth' | 'refresh' | 'constraint'

const requestTokens: Record<ContextRequestKey, number> = {
  inspect: 0,
  harvest: 0,
  memoryReview: 0,
  providerHealth: 0,
  refresh: 0,
  constraint: 0,
}

let activeSessionId: string | undefined

function nextRequestToken(key: ContextRequestKey): number {
  requestTokens[key] += 1
  return requestTokens[key]
}

function isLatestRequest(key: ContextRequestKey, token: number): boolean {
  return requestTokens[key] === token
}

function invalidateRequests(): void {
  for (const key of Object.keys(requestTokens) as ContextRequestKey[]) requestTokens[key] += 1
}

function activateSession(sessionId: string | undefined): boolean {
  if (!sessionId) return false
  const changed = activeSessionId !== sessionId
  activeSessionId = sessionId
  return changed
}

function isCurrentSession(sessionId: string | undefined): boolean {
  return !sessionId || !activeSessionId || activeSessionId === sessionId
}

function isActiveSession(sessionId: string | undefined): boolean {
  return Boolean(sessionId && activeSessionId === sessionId)
}

export const useContextStore = create<ContextStoreState>((set) => ({
  inspect: emptyRequest(),
  harvest: emptyRequest(),
  memoryReview: emptyRequest(),
  providerHealth: emptyRequest(),
  refresh: emptyRequest(),
  constraint: emptyRequest(),

  loadProjectContext: async (input) => {
    const sessionId = input.sessionId
    const sessionChanged = activateSession(sessionId)
    const inspectToken = nextRequestToken('inspect')
    const harvestToken = nextRequestToken('harvest')
    const memoryReviewToken = nextRequestToken('memoryReview')
    const providerHealthToken = nextRequestToken('providerHealth')
    const constraintToken = nextRequestToken('constraint')
    if (sessionChanged) nextRequestToken('refresh')
    set((state) => ({
      inspect: { ...state.inspect, loading: true, error: null },
      harvest: { ...state.harvest, loading: true, error: null },
      memoryReview: { ...state.memoryReview, loading: true, error: null },
      providerHealth: { ...state.providerHealth, loading: true, error: null },
      constraint: { ...state.constraint, loading: true, error: null },
      ...(sessionChanged ? { refresh: emptyRequest() } : {}),
    }))
    const [inspectResult, acceptedResult, providerHealthResult, constraintResult] = await Promise.allSettled([
      invokeContract<ContextInspectPayload>('context:inspect', { sessionId }),
      invokeContract<ContextAcceptedMemoryReview>('context:memory:list', { limit: 50, sessionId }),
      invokeContract<ContextProviderHealth>('context:providers:health', { sessionId, userMessage: '读取 JDC 上下文引擎提供方状态。', mode: 'debug' } satisfies ContextRefreshInput),
      invokeContract<ConstraintInspectState>('constraint:inspect', { sessionId }),
    ])
    const loadedAt = Date.now()
    const currentSession = isCurrentSession(sessionId)
    const inspectData = inspectResult.status === 'fulfilled' ? inspectResult.value : null
    const accepted = acceptedResult.status === 'fulfilled' ? acceptedResult.value : null
    const providerHealth = providerHealthResult.status === 'fulfilled' ? providerHealthResult.value : null
    const constraintData = constraintResult.status === 'fulfilled' ? constraintResult.value : null
    const inspectError = settledError(inspectResult)
    const memoryError = settledError(acceptedResult)
    const providerHealthError = settledError(providerHealthResult)
    const constraintError = settledError(constraintResult)

    set((state) => ({
      ...(currentSession && isLatestRequest('inspect', inspectToken)
        ? inspectData
          ? { inspect: { data: inspectData, loading: false, error: null, loadedAt } }
          : { inspect: { ...state.inspect, data: null, loading: false, error: inspectError } }
        : {}),
      ...(currentSession && isLatestRequest('harvest', harvestToken)
        ? inspectData
          ? { harvest: { data: inspectData.harvestQueue, loading: false, error: null, loadedAt } }
          : { harvest: { ...state.harvest, data: null, loading: false, error: inspectError } }
        : {}),
      ...(currentSession && isLatestRequest('memoryReview', memoryReviewToken)
        ? {
            memoryReview: {
              data: {
                accepted: accepted ?? state.memoryReview.data?.accepted ?? null,
                rejected: inspectData?.memoryReview.rejected ?? state.memoryReview.data?.rejected ?? [],
              },
              loading: false,
              error: memoryError,
              loadedAt,
            },
          }
        : {}),
      ...(currentSession && isLatestRequest('providerHealth', providerHealthToken)
        ? providerHealth
          ? { providerHealth: { data: providerHealth, loading: false, error: null, loadedAt } }
          : inspectData?.providerHealth.length
            ? { providerHealth: { data: inspectData.providerHealth as ContextProviderHealth, loading: false, error: providerHealthError, loadedAt } }
            : { providerHealth: { ...state.providerHealth, loading: false, error: providerHealthError } }
        : {}),
      ...(currentSession && isLatestRequest('constraint', constraintToken)
        ? constraintData
          ? { constraint: { data: constraintData, loading: false, error: null, loadedAt } }
          : { constraint: { ...state.constraint, data: null, loading: false, error: constraintError } }
        : {}),
    }))
  },

  loadInspect: async (input = {}) => {
    const sessionId = input.sessionId
    const sessionChanged = activateSession(sessionId)
    const inspectToken = nextRequestToken('inspect')
    const harvestToken = nextRequestToken('harvest')
    const memoryReviewToken = nextRequestToken('memoryReview')
    if (sessionChanged) {
      nextRequestToken('providerHealth')
      nextRequestToken('refresh')
      nextRequestToken('constraint')
    }
    const providerHealthToken = requestTokens.providerHealth
    set((state) => ({
      inspect: { ...state.inspect, loading: true, error: null },
      harvest: { ...state.harvest, loading: true, error: null },
      memoryReview: { ...state.memoryReview, loading: true, error: null },
      ...(sessionChanged ? { providerHealth: emptyRequest(), refresh: emptyRequest(), constraint: emptyRequest() } : {}),
    }))
    try {
      const data = await invokeContract<ContextInspectPayload>('context:inspect', input)
      const loadedAt = Date.now()
      const currentSession = isCurrentSession(sessionId)
      set((state) => ({
        ...(currentSession && isLatestRequest('inspect', inspectToken) ? { inspect: { data, loading: false, error: null, loadedAt } } : {}),
        ...(currentSession && isLatestRequest('harvest', harvestToken) ? { harvest: { data: data.harvestQueue, loading: false, error: null, loadedAt } } : {}),
        ...(currentSession && isLatestRequest('memoryReview', memoryReviewToken) ? { memoryReview: { data: { accepted: state.memoryReview.data?.accepted ?? null, rejected: data.memoryReview.rejected }, loading: false, error: null, loadedAt } } : {}),
        ...(currentSession && data.providerHealth.length > 0 && isLatestRequest('inspect', inspectToken) && isLatestRequest('providerHealth', providerHealthToken) ? { providerHealth: { data: data.providerHealth as ContextProviderHealth, loading: false, error: null, loadedAt } } : {}),
      }))
    } catch (error) {
      const message = requestError(error)
      const currentSession = isCurrentSession(sessionId)
      set((state) => ({
        ...(currentSession && isLatestRequest('inspect', inspectToken) ? { inspect: { ...state.inspect, data: null, loading: false, error: message } } : {}),
        ...(currentSession && isLatestRequest('harvest', harvestToken) ? { harvest: { ...state.harvest, data: null, loading: false, error: message } } : {}),
        ...(currentSession && isLatestRequest('memoryReview', memoryReviewToken) ? { memoryReview: { ...state.memoryReview, data: null, loading: false, error: message } } : {}),
      }))
    }
  },

  loadHarvestQueue: async (input = {}) => {
    const sessionId = input.sessionId
    const token = nextRequestToken('harvest')
    set((state) => ({ harvest: { ...state.harvest, loading: true, error: null } }))
    try {
      const data = await invokeContract<ContextHarvestQueue>('context:harvest:list', input)
      if (isLatestRequest('harvest', token) && isCurrentSession(sessionId)) set({ harvest: { data, loading: false, error: null, loadedAt: Date.now() } })
    } catch (error) {
      if (isLatestRequest('harvest', token) && isCurrentSession(sessionId)) set((state) => ({ harvest: { ...state.harvest, data: null, loading: false, error: requestError(error) } }))
    }
  },

  loadMemoryReview: async (input = {}) => {
    const sessionId = input.sessionId
    const token = nextRequestToken('memoryReview')
    set((state) => ({ memoryReview: { ...state.memoryReview, loading: true, error: null } }))
    try {
      const acceptedInput = input.sessionId ? { limit: 50, sessionId: input.sessionId } : { limit: 50 }
      const [accepted, inspect] = await Promise.all([
        invokeContract<ContextAcceptedMemoryReview>('context:memory:list', acceptedInput),
        invokeContract<ContextInspectPayload>('context:inspect', input),
      ])
      if (isLatestRequest('memoryReview', token) && isCurrentSession(sessionId)) set({ memoryReview: { data: { accepted, rejected: inspect.memoryReview.rejected }, loading: false, error: null, loadedAt: Date.now() } })
    } catch (error) {
      if (isLatestRequest('memoryReview', token) && isCurrentSession(sessionId)) set((state) => ({ memoryReview: { ...state.memoryReview, data: null, loading: false, error: requestError(error) } }))
    }
  },

  loadProviderHealth: async (input) => {
    const sessionId = input.sessionId
    const token = nextRequestToken('providerHealth')
    set((state) => ({ providerHealth: { ...state.providerHealth, loading: true, error: null } }))
    try {
      const data = await invokeContract<ContextProviderHealth>('context:providers:health', input)
      if (isLatestRequest('providerHealth', token) && isCurrentSession(sessionId)) set({ providerHealth: { data, loading: false, error: null, loadedAt: Date.now() } })
    } catch (error) {
      if (isLatestRequest('providerHealth', token) && isCurrentSession(sessionId)) set((state) => ({ providerHealth: { ...state.providerHealth, data: null, loading: false, error: requestError(error) } }))
    }
  },

  loadConstraintInspect: async (input) => {
    const sessionId = input.sessionId
    const token = nextRequestToken('constraint')
    set((state) => ({ constraint: { ...state.constraint, loading: true, error: null } }))
    try {
      const data = await invokeContract<ConstraintInspectState>('constraint:inspect', { sessionId })
      if (isLatestRequest('constraint', token) && isCurrentSession(sessionId)) set({ constraint: { data, loading: false, error: null, loadedAt: Date.now() } })
    } catch (error) {
      if (isLatestRequest('constraint', token) && isCurrentSession(sessionId)) set((state) => ({ constraint: { ...state.constraint, data: null, loading: false, error: requestError(error) } }))
    }
  },

  refreshProviders: async (input) => {
    const sessionId = input.sessionId
    const refreshToken = nextRequestToken('refresh')
    const providerHealthToken = nextRequestToken('providerHealth')
    set((state) => ({ refresh: { ...state.refresh, loading: true, error: null } }))
    try {
      const data = await invokeContract<ContextRefreshState>('context:refresh', input)
      const loadedAt = Date.now()
      set({
        ...(isLatestRequest('refresh', refreshToken) && isCurrentSession(sessionId) ? { refresh: { data, loading: false, error: null, loadedAt } } : {}),
        ...(isLatestRequest('providerHealth', providerHealthToken) && isCurrentSession(sessionId) ? { providerHealth: { data: data.providerHealth as ContextProviderHealth, loading: false, error: null, loadedAt } } : {}),
      })
    } catch (error) {
      if (isLatestRequest('refresh', refreshToken) && isCurrentSession(sessionId)) set((state) => ({ refresh: { ...state.refresh, data: null, loading: false, error: requestError(error) } }))
    }
  },

  acceptMemoryCandidate: async (candidateId, sessionId) => {
    const token = nextRequestToken('memoryReview')
    try {
      const data = await invokeContract<ContextRejectedMemoryReview>('context:memory:accept', { candidateId, sessionId })
      if (!isLatestRequest('memoryReview', token) || !isActiveSession(sessionId)) return
      set((state) => ({
        memoryReview: {
          ...state.memoryReview,
          data: state.memoryReview.data ? { accepted: state.memoryReview.data.accepted, rejected: data.rejected } : null,
          error: null,
        },
      }))
    } catch (error) {
      if (!isLatestRequest('memoryReview', token) || !isActiveSession(sessionId)) return
      set((state) => ({ memoryReview: { ...state.memoryReview, error: requestError(error) } }))
    }
  },

  rejectMemoryCandidate: async (candidateId, sessionId) => {
    const token = nextRequestToken('memoryReview')
    try {
      const data = await invokeContract<ContextRejectedMemoryReview>('context:memory:reject', { candidateId, sessionId })
      if (!isLatestRequest('memoryReview', token) || !isActiveSession(sessionId)) return
      set((state) => ({
        memoryReview: {
          ...state.memoryReview,
          data: state.memoryReview.data ? { accepted: state.memoryReview.data.accepted, rejected: data.rejected } : null,
          error: null,
        },
      }))
    } catch (error) {
      if (!isLatestRequest('memoryReview', token) || !isActiveSession(sessionId)) return
      set((state) => ({ memoryReview: { ...state.memoryReview, error: requestError(error) } }))
    }
  },

  reset: () => {
    invalidateRequests()
    activeSessionId = undefined
    set({
      inspect: emptyRequest(),
      harvest: emptyRequest(),
      memoryReview: emptyRequest(),
      providerHealth: emptyRequest(),
      refresh: emptyRequest(),
      constraint: emptyRequest(),
    })
  },
}))
