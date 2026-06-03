import type { ContextPerformanceRecorder, ContextOperationLane } from './performance.js'
import { createContextPerformanceRecorder } from './performance.js'

export type BackgroundRejectReason = 'project_concurrency_limit' | 'project_interval_limit'
export type BackgroundJobResult = { accepted: true; promise: Promise<void>; reason?: never } | { accepted: false; reason: BackgroundRejectReason; promise?: never }

export interface ContextScheduler {
  runForeground<T>(name: string, timeoutMs: number, task: (signal: AbortSignal) => Promise<T>, degraded: T): Promise<T>
  enqueueBackground(projectKey: string, name: string, task: (signal: AbortSignal) => Promise<void>, options?: { minIntervalMs?: number }): BackgroundJobResult
  cancelProject(projectKey: string): void
  recorder: ContextPerformanceRecorder
}

export function createContextScheduler(options: {
  recorder?: ContextPerformanceRecorder
  now?: () => number
  maxBackgroundPerProject?: number
} = {}): ContextScheduler {
  const recorder = options.recorder ?? createContextPerformanceRecorder({ now: options.now })
  const now = options.now ?? Date.now
  const maxBackgroundPerProject = options.maxBackgroundPerProject ?? 1
  const active = new Map<string, Set<AbortController>>()
  const lastStartedAtByProjectJob = new Map<string, number>()

  async function runMeasured<T>(lane: ContextOperationLane, name: string, projectKey: string | undefined, task: (signal: AbortSignal) => Promise<T>, timeoutMs?: number, degraded?: T): Promise<T> {
    const startedAt = now()
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    const taskResult = Promise.resolve()
      .then(() => task(controller.signal))
      .then(
        (value) => ({ type: 'success' as const, value }),
        (error) => ({ type: 'error' as const, error }),
      )
    let timeoutResult: Promise<{ type: 'timeout' }> | undefined
    if (timeoutMs !== undefined) {
      timeoutResult = new Promise((resolve) => {
        timer = setTimeout(() => {
          timedOut = true
          controller.abort()
          resolve({ type: 'timeout' })
        }, timeoutMs)
      })
    }
    try {
      const result = timeoutResult ? await Promise.race([taskResult, timeoutResult]) : await taskResult
      if (result.type === 'timeout') {
        recorder.record({ name, lane, status: 'timeout', startedAt, completedAt: now(), projectKey, diagnostic: 'context budget expired' })
        if (degraded !== undefined) return degraded
        throw new Error('context budget expired')
      }
      if (result.type === 'error') {
        throw result.error
      }
      const { value } = result
      recorder.record({ name, lane, status: 'success', startedAt, completedAt: now(), projectKey })
      return value
    } catch (error) {
      const aborted = controller.signal.aborted || timedOut
      recorder.record({
        name,
        lane,
        status: aborted ? 'timeout' : 'failed',
        startedAt,
        completedAt: now(),
        projectKey,
        diagnostic: error instanceof Error ? error.message : String(error),
      })
      if (aborted && degraded !== undefined) return degraded
      throw error
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  return {
    recorder,
    runForeground(name, timeoutMs, task, degraded) {
      return runMeasured('foreground', name, undefined, task, timeoutMs, degraded)
    },
    enqueueBackground(projectKey, name, task, jobOptions = {}) {
      const startedAt = now()
      const intervalKey = `${projectKey}:${name}`
      const lastStartedAt = lastStartedAtByProjectJob.get(intervalKey)
      if (jobOptions.minIntervalMs && lastStartedAt !== undefined && startedAt - lastStartedAt < jobOptions.minIntervalMs) {
        recorder.record({ name, lane: 'background', status: 'rejected', startedAt, completedAt: now(), projectKey, diagnostic: 'project_interval_limit' })
        return { accepted: false, reason: 'project_interval_limit' }
      }
      const set = active.get(projectKey) ?? new Set<AbortController>()
      if (set.size >= maxBackgroundPerProject) {
        recorder.record({ name, lane: 'background', status: 'rejected', startedAt, completedAt: now(), projectKey, diagnostic: 'project_concurrency_limit' })
        return { accepted: false, reason: 'project_concurrency_limit' }
      }
      const controller = new AbortController()
      set.add(controller)
      active.set(projectKey, set)
      lastStartedAtByProjectJob.set(intervalKey, startedAt)
      const promise = Promise.resolve()
        .then(() => task(controller.signal))
        .then(() => {
          recorder.record({ name, lane: 'background', status: 'success', startedAt, completedAt: now(), projectKey })
        })
        .catch((error) => {
          recorder.record({ name, lane: 'background', status: controller.signal.aborted ? 'cancelled' : 'failed', startedAt, completedAt: now(), projectKey, diagnostic: error instanceof Error ? error.message : String(error) })
        })
        .finally(() => {
          set.delete(controller)
          if (set.size === 0 && active.get(projectKey) === set) active.delete(projectKey)
        })
      return { accepted: true, promise }
    },
    cancelProject(projectKey) {
      const set = active.get(projectKey)
      if (!set) return
      for (const controller of set) controller.abort()
    },
  }
}
