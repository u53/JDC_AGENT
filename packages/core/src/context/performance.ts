export type ContextOperationLane = 'foreground' | 'background' | 'renderer' | 'storage'
export type ContextOperationStatus = 'success' | 'timeout' | 'cancelled' | 'failed' | 'rejected'

export interface ContextOperationMetric {
  id: string
  name: string
  lane: ContextOperationLane
  status: ContextOperationStatus
  startedAt: number
  completedAt: number
  durationMs: number
  projectKey?: string
  diagnostic?: string
}

export interface ContextPerformanceSnapshot {
  operations: ContextOperationMetric[]
}

export interface ContextPerformanceRecorder {
  record(metric: Omit<ContextOperationMetric, 'id' | 'durationMs'>): void
  snapshot(): ContextPerformanceSnapshot
  clear(): void
}

export function createContextPerformanceRecorder(options: { now?: () => number; maxOperations?: number } = {}): ContextPerformanceRecorder {
  const now = options.now ?? Date.now
  const maxOperations = options.maxOperations ?? 500
  const operations: ContextOperationMetric[] = []
  let counter = 0

  return {
    record(metric) {
      operations.push({
        ...metric,
        id: `ctx_perf_${++counter}`,
        durationMs: Math.max(0, metric.completedAt - metric.startedAt),
      })
      while (operations.length > maxOperations) operations.shift()
    },
    snapshot() {
      return { operations: [...operations] }
    },
    clear() {
      operations.length = 0
      counter = 0
      void now
    },
  }
}
