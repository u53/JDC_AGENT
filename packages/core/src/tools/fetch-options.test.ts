import { describe, expect, it } from 'vitest'
import { makeFetchOptions } from './fetch-options.js'

describe('makeFetchOptions', () => {
  it('uses an undici dispatcher for proxy-backed fetch calls', () => {
    const opts = makeFetchOptions({ proxy: 'http://127.0.0.1:7890', timeoutMs: 15000 })

    expect((opts as any).dispatcher).toBeDefined()
    expect((opts as any).agent).toBeUndefined()
  })

  it('preserves explicit headers and signal', () => {
    const signal = AbortSignal.timeout(1000)
    const opts = makeFetchOptions({
      proxy: undefined,
      signal,
      headers: { Accept: 'application/json' },
    })

    expect(opts.signal).toBe(signal)
    expect(opts.headers).toEqual({ Accept: 'application/json' })
  })
})
