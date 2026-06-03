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

  it('limits project background jobs by key', async () => {
    const recorder = createContextPerformanceRecorder({ now: () => Date.now() })
    const scheduler = createContextScheduler({ recorder, now: () => Date.now(), maxBackgroundPerProject: 1 })
    const release = deferred<void>()
    const first = scheduler.enqueueBackground('repo-a', 'harvest', async () => {
      await release.promise
    })
    const second = scheduler.enqueueBackground('repo-a', 'harvest', async () => undefined)

    expect(first.accepted).toBe(true)
    expect(second.accepted).toBe(false)
    expect(second.reason).toBe('project_concurrency_limit')

    release.resolve()
    await first.promise
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

  it('keeps cancelled project jobs counted until their task settles', async () => {
    const recorder = createContextPerformanceRecorder({ now: () => Date.now() })
    const scheduler = createContextScheduler({ recorder, now: () => Date.now(), maxBackgroundPerProject: 1 })
    const release = deferred<void>()

    const first = scheduler.enqueueBackground('repo-a', 'harvest', async () => {
      await release.promise
    })
    expect(first.accepted).toBe(true)

    scheduler.cancelProject('repo-a')
    const second = scheduler.enqueueBackground('repo-a', 'harvest', async () => undefined)
    expect(second.accepted).toBe(false)
    expect(second.reason).toBe('project_concurrency_limit')

    release.resolve()
    if (first.accepted) await first.promise

    const third = scheduler.enqueueBackground('repo-a', 'harvest', async () => undefined)
    expect(third.accepted).toBe(true)
    if (third.accepted) await third.promise
  })

  it('rate limits background jobs by project and job name', async () => {
    let clock = 1_000
    const recorder = createContextPerformanceRecorder({ now: () => clock })
    const scheduler = createContextScheduler({ recorder, now: () => clock, maxBackgroundPerProject: 1 })

    const first = scheduler.enqueueBackground('repo-a', 'harvest', async () => undefined, { minIntervalMs: 30_000 })
    expect(first.accepted).toBe(true)
    if (first.accepted) await first.promise

    clock = 5_000
    const second = scheduler.enqueueBackground('repo-a', 'harvest', async () => undefined, { minIntervalMs: 30_000 })
    expect(second.accepted).toBe(false)
    expect(second.reason).toBe('project_interval_limit')

    clock = 31_500
    const third = scheduler.enqueueBackground('repo-a', 'harvest', async () => undefined, { minIntervalMs: 30_000 })
    expect(third.accepted).toBe(true)
    if (third.accepted) await third.promise
  })
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
