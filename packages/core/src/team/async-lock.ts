/**
 * AsyncLock — per-key serialization for async operations.
 *
 * Different from the sync `acquireFileLock` in team-concurrency.ts:
 * - Sync lock: returns true/false immediately (used to gate write tool calls).
 * - This lock: callers `await` until the lock is free (used to serialize fs writes).
 */
export class AsyncLock {
  private chains = new Map<string, Promise<unknown>>()

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve()
    let resolveNext!: () => void
    const next = new Promise<void>((r) => {
      resolveNext = r
    })
    const tail = prev.then(() => next)
    this.chains.set(key, tail)
    try {
      await prev
      return await fn()
    } finally {
      resolveNext()
      // Clean up only if no later caller has chained on top of us
      if (this.chains.get(key) === tail) {
        this.chains.delete(key)
      }
    }
  }
}
