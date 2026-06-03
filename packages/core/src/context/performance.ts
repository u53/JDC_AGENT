export type ContextOperationLane = 'foreground' | 'background' | 'renderer' | 'storage'
export type ContextOperationStatus = 'success' | 'timeout' | 'cancelled' | 'failed' | 'rejected'
export type ContextOperationMetadata = Record<string, string | number | boolean | null>

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
  metadata?: ContextOperationMetadata
}

export interface ContextPerformanceSnapshot {
  operations: ContextOperationMetric[]
}

export interface ContextPerformanceRecorder {
  record(metric: Omit<ContextOperationMetric, 'id' | 'durationMs'>): void
  snapshot(): ContextPerformanceSnapshot
  clear(): void
}

export interface ContextPerformanceOperationSummary {
  count: number
  p50Ms: number
  p95Ms: number
  maxMs: number
}

export interface ContextPerformanceSummary {
  totalOperations: number
  byStatus: Partial<Record<ContextOperationStatus, number>>
  byLane: Partial<Record<ContextOperationLane, number>>
  byName: Record<string, ContextPerformanceOperationSummary>
  slowest: ContextOperationMetric[]
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

export async function recordContextOperation<T>(
  recorder: ContextPerformanceRecorder | undefined,
  options: {
    name: string
    lane: ContextOperationLane
    projectKey?: string
    metadata?: ContextOperationMetadata
    now?: () => number
  },
  task: () => Promise<T> | T,
): Promise<T> {
  const now = options.now ?? Date.now
  const startedAt = now()
  try {
    const value = await task()
    recorder?.record({
      name: options.name,
      lane: options.lane,
      status: 'success',
      startedAt,
      completedAt: now(),
      projectKey: options.projectKey,
      metadata: options.metadata,
    })
    return value
  } catch (error) {
    recorder?.record({
      name: options.name,
      lane: options.lane,
      status: 'failed',
      startedAt,
      completedAt: now(),
      projectKey: options.projectKey,
      diagnostic: error instanceof Error ? error.message : String(error),
      metadata: options.metadata,
    })
    throw error
  }
}

export function summarizeContextPerformance(snapshot: ContextPerformanceSnapshot, options: { slowestLimit?: number } = {}): ContextPerformanceSummary {
  const operations = snapshot.operations
  const byStatus: Partial<Record<ContextOperationStatus, number>> = {}
  const byLane: Partial<Record<ContextOperationLane, number>> = {}
  const byNameDurations = new Map<string, number[]>()

  for (const operation of operations) {
    byStatus[operation.status] = (byStatus[operation.status] ?? 0) + 1
    byLane[operation.lane] = (byLane[operation.lane] ?? 0) + 1
    const durations = byNameDurations.get(operation.name) ?? []
    durations.push(operation.durationMs)
    byNameDurations.set(operation.name, durations)
  }

  const byName: Record<string, ContextPerformanceOperationSummary> = {}
  for (const [name, durations] of byNameDurations) {
    const sorted = [...durations].sort((a, b) => a - b)
    byName[name] = {
      count: sorted.length,
      p50Ms: percentileNearestRank(sorted, 0.5),
      p95Ms: percentileNearestRank(sorted, 0.95),
      maxMs: sorted[sorted.length - 1] ?? 0,
    }
  }

  return {
    totalOperations: operations.length,
    byStatus,
    byLane,
    byName,
    slowest: [...operations]
      .sort((a, b) => b.durationMs - a.durationMs || b.completedAt - a.completedAt || a.id.localeCompare(b.id))
      .slice(0, options.slowestLimit ?? 10),
  }
}

function percentileNearestRank(sortedDurations: number[], percentile: number): number {
  if (sortedDurations.length === 0) return 0
  const index = Math.max(0, Math.ceil(percentile * sortedDurations.length) - 1)
  return sortedDurations[Math.min(index, sortedDurations.length - 1)] ?? 0
}
