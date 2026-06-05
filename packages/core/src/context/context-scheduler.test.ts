import { afterEach, describe, expect, it, vi } from 'vitest'
import { createContextPerformanceRecorder } from './performance.js'
import { createContextScheduler } from './scheduler.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('JDC Context Engine scheduler', () => {
  it('records foreground operation duration and returns degraded result when budget expires', async () => {
    vi.useFakeTimers()
    const recorder = createContextPerformanceRecorder({ now: () => Date.now() })
    const scheduler = createContextScheduler({ recorder, now: () => Date.now() })
    const slow = scheduler.runForeground('provider:code', 50, async (signal) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 100)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('aborted by context budget'))
        })
      })
      return 'slow-result'
    }, 'degraded-result')

    await vi.advanceTimersByTimeAsync(60)

    await expect(slow).resolves.toBe('degraded-result')
    expect(recorder.snapshot().operations[0]).toMatchObject({
      name: 'provider:code',
      lane: 'foreground',
      status: 'timeout',
    })
  })

  it('queues project background jobs by key instead of rejecting concurrency', async () => {
    const recorder = createContextPerformanceRecorder({ now: () => Date.now() })
    const scheduler = createContextScheduler({ recorder, now: () => Date.now(), maxBackgroundPerProject: 1 })
    const release = deferred<void>()
    const order: string[] = []
    const first = scheduler.enqueueBackground('repo-a', 'harvest', async () => {
      order.push('first:start')
      await release.promise
      order.push('first:end')
    })
    const second = scheduler.enqueueBackground('repo-a', 'harvest', async () => {
      order.push('second')
    })

    expect(first.accepted).toBe(true)
    expect(second.accepted).toBe(true)
    await Promise.resolve()
    expect(order).toEqual(['first:start'])

    release.resolve()
    await first.promise
    await second.promise

    expect(order).toEqual(['first:start', 'first:end', 'second'])
    expect(recorder.snapshot().operations.map(operation => operation.status)).toEqual(['success', 'success'])
  })

  it('records synchronous background task failures and releases the project slot', async () => {
    const recorder = createContextPerformanceRecorder({ now: () => Date.now() })
    const scheduler = createContextScheduler({ recorder, now: () => Date.now(), maxBackgroundPerProject: 1 })

    const first = scheduler.enqueueBackground('repo-a', 'harvest', () => {
      throw new Error('sync background failure')
    })
    expect(first.accepted).toBe(true)
    if (first.accepted) await first.promise

    expect(recorder.snapshot().operations[0]).toMatchObject({
      name: 'harvest',
      lane: 'background',
      status: 'failed',
      diagnostic: 'sync background failure',
    })

    const second = scheduler.enqueueBackground('repo-a', 'harvest', async () => undefined)
    expect(second.accepted).toBe(true)
    if (second.accepted) await second.promise
  })

  it('queues follow-up jobs behind cancelled project jobs until their task settles', async () => {
    const recorder = createContextPerformanceRecorder({ now: () => Date.now() })
    const scheduler = createContextScheduler({ recorder, now: () => Date.now(), maxBackgroundPerProject: 1 })
    const release = deferred<void>()
    const order: string[] = []

    const first = scheduler.enqueueBackground('repo-a', 'harvest', async () => {
      order.push('first:start')
      await release.promise
    })
    expect(first.accepted).toBe(true)

    scheduler.cancelProject('repo-a')
    const second = scheduler.enqueueBackground('repo-a', 'harvest', async () => {
      order.push('second')
    })
    expect(second.accepted).toBe(true)
    await Promise.resolve()
    expect(order).toEqual(['first:start'])

    release.resolve()
    if (first.accepted) await first.promise
    if (second.accepted) await second.promise

    expect(order).toEqual(['first:start', 'second'])

    const third = scheduler.enqueueBackground('repo-a', 'harvest', async () => {
      order.push('third')
    })
    expect(third.accepted).toBe(true)
    if (third.accepted) await third.promise
    expect(order).toEqual(['first:start', 'second', 'third'])
  })

  it('cancels queued project jobs before they start', async () => {
    const recorder = createContextPerformanceRecorder({ now: () => Date.now() })
    const scheduler = createContextScheduler({ recorder, now: () => Date.now(), maxBackgroundPerProject: 1 })
    const release = deferred<void>()
    const order: string[] = []

    const first = scheduler.enqueueBackground('repo-a', 'harvest', async () => {
      order.push('first:start')
      await release.promise
    })
    const second = scheduler.enqueueBackground('repo-a', 'harvest', async () => {
      order.push('second')
    })

    expect(first.accepted).toBe(true)
    expect(second.accepted).toBe(true)
    await Promise.resolve()
    scheduler.cancelProject('repo-a')
    release.resolve()
    await first.promise
    await second.promise

    expect(order).toEqual(['first:start'])
    expect(recorder.snapshot().operations).toContainEqual(expect.objectContaining({
      name: 'harvest',
      lane: 'background',
      status: 'cancelled',
      projectKey: 'repo-a',
      diagnostic: 'project background job cancelled before start',
    }))
  })

  it('records cancelled background jobs after project cancellation settles', async () => {
    const recorder = createContextPerformanceRecorder({ now: () => Date.now() })
    const scheduler = createContextScheduler({ recorder, now: () => Date.now(), maxBackgroundPerProject: 1 })

    const job = scheduler.enqueueBackground('repo-a', 'warm-index', async (signal) => {
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) {
          reject(new Error('project warmup cancelled'))
          return
        }
        signal.addEventListener('abort', () => reject(new Error('project warmup cancelled')), { once: true })
      })
    })

    expect(job.accepted).toBe(true)
    scheduler.cancelProject('repo-a')
    if (job.accepted) await job.promise

    expect(recorder.snapshot().operations.at(-1)).toMatchObject({
      name: 'warm-index',
      lane: 'background',
      status: 'cancelled',
      projectKey: 'repo-a',
      diagnostic: 'project warmup cancelled',
    })
  })

  it('queues rate-limited background jobs until the project/job interval elapses', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const recorder = createContextPerformanceRecorder({ now: () => Date.now() })
    const scheduler = createContextScheduler({ recorder, now: () => Date.now(), maxBackgroundPerProject: 1 })
    const order: string[] = []

    const first = scheduler.enqueueBackground('repo-a', 'harvest', async () => {
      order.push('first')
    }, { minIntervalMs: 30_000 })
    expect(first.accepted).toBe(true)
    if (first.accepted) await first.promise

    vi.setSystemTime(5_000)
    const second = scheduler.enqueueBackground('repo-a', 'harvest', async () => {
      order.push('second')
    }, { minIntervalMs: 30_000 })
    expect(second.accepted).toBe(true)
    await Promise.resolve()
    expect(order).toEqual(['first'])

    await vi.advanceTimersByTimeAsync(25_999)
    expect(order).toEqual(['first'])

    await vi.advanceTimersByTimeAsync(1)
    if (second.accepted) await second.promise
    expect(order).toEqual(['first', 'second'])
  })
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
