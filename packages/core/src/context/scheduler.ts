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

interface QueuedBackgroundJob {
  projectKey: string
  name: string
  task: (signal: AbortSignal) => Promise<void>
  options: { minIntervalMs?: number }
  controller: AbortController
  enqueuedAt: number
  startedAt?: number
  resolve: () => void
}

interface ProjectBackgroundQueue {
  active: Set<QueuedBackgroundJob>
  queued: QueuedBackgroundJob[]
  drainTimer?: ReturnType<typeof setTimeout>
}

export function createContextScheduler(options: {
  recorder?: ContextPerformanceRecorder
  now?: () => number
  maxBackgroundPerProject?: number
} = {}): ContextScheduler {
  const recorder = options.recorder ?? createContextPerformanceRecorder({ now: options.now })
  const now = options.now ?? Date.now
  const maxBackgroundPerProject = options.maxBackgroundPerProject ?? 1
  const backgroundQueues = new Map<string, ProjectBackgroundQueue>()
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

  function getProjectQueue(projectKey: string): ProjectBackgroundQueue {
    const existing = backgroundQueues.get(projectKey)
    if (existing) return existing
    const created: ProjectBackgroundQueue = { active: new Set(), queued: [] }
    backgroundQueues.set(projectKey, created)
    return created
  }

  function deleteProjectQueueIfIdle(projectKey: string, queue: ProjectBackgroundQueue): void {
    if (queue.active.size > 0 || queue.queued.length > 0 || queue.drainTimer) return
    if (backgroundQueues.get(projectKey) === queue) backgroundQueues.delete(projectKey)
  }

  function intervalKey(job: QueuedBackgroundJob): string {
    return `${job.projectKey}:${job.name}`
  }

  function delayUntilRunnable(job: QueuedBackgroundJob): number {
    const minIntervalMs = job.options.minIntervalMs
    if (!minIntervalMs) return 0
    const lastStartedAt = lastStartedAtByProjectJob.get(intervalKey(job))
    if (lastStartedAt === undefined) return 0
    return Math.max(0, minIntervalMs - (now() - lastStartedAt))
  }

  function scheduleDrain(projectKey: string, queue: ProjectBackgroundQueue, delayMs: number): void {
    if (queue.drainTimer) return
    queue.drainTimer = setTimeout(() => {
      queue.drainTimer = undefined
      drainProjectQueue(projectKey)
    }, delayMs)
  }

  function backgroundMetadata(job: QueuedBackgroundJob, startedAt: number): { queuedMs: number } | undefined {
    const queuedMs = Math.max(0, startedAt - job.enqueuedAt)
    return queuedMs > 0 ? { queuedMs } : undefined
  }

  function recordQueuedCancellation(job: QueuedBackgroundJob): void {
    const completedAt = now()
    recorder.record({
      name: job.name,
      lane: 'background',
      status: 'cancelled',
      startedAt: job.enqueuedAt,
      completedAt,
      projectKey: job.projectKey,
      diagnostic: 'project background job cancelled before start',
      metadata: backgroundMetadata(job, completedAt),
    })
  }

  function startBackgroundJob(projectKey: string, queue: ProjectBackgroundQueue, job: QueuedBackgroundJob): void {
    const startedAt = now()
    job.startedAt = startedAt
    lastStartedAtByProjectJob.set(intervalKey(job), startedAt)
    queue.active.add(job)
    Promise.resolve()
      .then(() => job.task(job.controller.signal))
      .then(() => {
        recorder.record({
          name: job.name,
          lane: 'background',
          status: 'success',
          startedAt,
          completedAt: now(),
          projectKey,
          metadata: backgroundMetadata(job, startedAt),
        })
      })
      .catch((error) => {
        recorder.record({
          name: job.name,
          lane: 'background',
          status: job.controller.signal.aborted ? 'cancelled' : 'failed',
          startedAt,
          completedAt: now(),
          projectKey,
          diagnostic: error instanceof Error ? error.message : String(error),
          metadata: backgroundMetadata(job, startedAt),
        })
      })
      .finally(() => {
        queue.active.delete(job)
        job.resolve()
        drainProjectQueue(projectKey)
        deleteProjectQueueIfIdle(projectKey, queue)
      })
  }

  function drainProjectQueue(projectKey: string): void {
    const queue = backgroundQueues.get(projectKey)
    if (!queue) return

    let soonestDelayMs: number | undefined
    while (queue.active.size < maxBackgroundPerProject && queue.queued.length > 0) {
      let selectedIndex = -1
      for (let index = 0; index < queue.queued.length; index++) {
        const job = queue.queued[index]!
        if (job.controller.signal.aborted) {
          queue.queued.splice(index, 1)
          recordQueuedCancellation(job)
          job.resolve()
          index--
          continue
        }
        const delayMs = delayUntilRunnable(job)
        if (delayMs <= 0) {
          selectedIndex = index
          break
        }
        soonestDelayMs = Math.min(soonestDelayMs ?? delayMs, delayMs)
      }

      if (selectedIndex < 0) break
      const [job] = queue.queued.splice(selectedIndex, 1)
      if (job) startBackgroundJob(projectKey, queue, job)
    }

    if (queue.active.size < maxBackgroundPerProject && queue.queued.length > 0 && soonestDelayMs !== undefined) {
      scheduleDrain(projectKey, queue, soonestDelayMs)
    }
    deleteProjectQueueIfIdle(projectKey, queue)
  }

  return {
    recorder,
    runForeground(name, timeoutMs, task, degraded) {
      return runMeasured('foreground', name, undefined, task, timeoutMs, degraded)
    },
    enqueueBackground(projectKey, name, task, jobOptions = {}) {
      if (maxBackgroundPerProject <= 0) {
        const startedAt = now()
        recorder.record({ name, lane: 'background', status: 'rejected', startedAt, completedAt: now(), projectKey, diagnostic: 'project_concurrency_limit' })
        return { accepted: false, reason: 'project_concurrency_limit' }
      }
      const queue = getProjectQueue(projectKey)
      const controller = new AbortController()
      let resolve!: () => void
      const promise = new Promise<void>((r) => { resolve = r })
      const job: QueuedBackgroundJob = {
        projectKey,
        name,
        task,
        options: jobOptions,
        controller,
        enqueuedAt: now(),
        resolve,
      }
      queue.queued.push(job)
      drainProjectQueue(projectKey)
      return { accepted: true, promise }
    },
    cancelProject(projectKey) {
      const queue = backgroundQueues.get(projectKey)
      if (!queue) return
      for (const job of queue.active) job.controller.abort()
      if (queue.drainTimer) {
        clearTimeout(queue.drainTimer)
        queue.drainTimer = undefined
      }
      const queued = queue.queued.splice(0)
      for (const job of queued) {
        job.controller.abort()
        recordQueuedCancellation(job)
        job.resolve()
      }
      deleteProjectQueueIfIdle(projectKey, queue)
    },
  }
}
