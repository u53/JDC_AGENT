import { describe, it, expect } from 'vitest'
import { isRetryableStreamError, withStreamRetry } from '../src/providers/stream-retry.js'
import type { StreamChunk } from '../src/types.js'

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function streamOf(...chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  return (async function* () {
    for (const c of chunks) yield c
  })()
}

describe('isRetryableStreamError', () => {
  it('treats undici socket drops as retryable', () => {
    expect(isRetryableStreamError(new TypeError('terminated'))).toBe(true)
    expect(isRetryableStreamError(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }))).toBe(true)
    expect(isRetryableStreamError(Object.assign(new Error('x'), { cause: { message: 'other side closed' } }))).toBe(true)
  })

  it('treats the OpenAI SDK connection errors as retryable', () => {
    expect(isRetryableStreamError({ name: 'APIConnectionError', message: 'Connection error.' })).toBe(true)
    expect(isRetryableStreamError({ name: 'APIConnectionTimeoutError', message: 'Request timed out.' })).toBe(true)
  })

  it('uses numeric status from either prefix or .status', () => {
    expect(isRetryableStreamError(new Error('529 overloaded'))).toBe(true)
    expect(isRetryableStreamError(new Error('429 rate limited'))).toBe(true)
    expect(isRetryableStreamError({ status: 503, message: 'Service Unavailable' })).toBe(true)
    expect(isRetryableStreamError({ status: 400, message: 'Bad Request' })).toBe(false)
    expect(isRetryableStreamError(new Error('401 unauthorized'))).toBe(false)
  })

  it('never retries a user abort', () => {
    expect(isRetryableStreamError(Object.assign(new Error('Aborted'), { name: 'AbortError' }))).toBe(false)
    expect(isRetryableStreamError({ name: 'APIUserAbortError', message: 'Request was aborted.' })).toBe(false)
  })
})

describe('withStreamRetry', () => {
  it('reports retry progress before waiting for the next attempt', async () => {
    let attempts = 0
    const retries: Array<{ attempt: number; maxRetries: number }> = []
    const out = await collect(withStreamRetry(
      () => {
        attempts++
        if (attempts < 2) throw new TypeError('terminated')
        return streamOf({ type: 'text_delta', text: 'ok' })
      },
      undefined,
      2,
      (attempt, _error, _delayMs, maxRetries) => {
        retries.push({ attempt, maxRetries })
      },
    ))

    expect(out).toEqual([{ type: 'text_delta', text: 'ok' }])
    expect(retries).toEqual([{ attempt: 1, maxRetries: 2 }])
  })

  it('retries when the failure happens before the first chunk', async () => {
    let attempts = 0
    const out = await collect(withStreamRetry(() => {
      attempts++
      if (attempts < 2) throw new TypeError('terminated')
      return streamOf({ type: 'text_delta', text: 'ok' })
    }))
    expect(attempts).toBe(2)
    expect(out).toEqual([{ type: 'text_delta', text: 'ok' }])
  })

  it('does NOT retry once a chunk has been yielded', async () => {
    let attempts = 0
    const factory = () => {
      attempts++
      return (async function* () {
        yield { type: 'text_delta', text: 'partial' } as StreamChunk
        throw new TypeError('terminated')
      })()
    }
    await expect(collect(withStreamRetry(factory))).rejects.toThrow('terminated')
    expect(attempts).toBe(1)
  })

  it('does not retry non-retryable errors', async () => {
    let attempts = 0
    const factory = () => {
      attempts++
      throw new Error('400 bad request')
    }
    await expect(collect(withStreamRetry(factory))).rejects.toThrow('400')
    expect(attempts).toBe(1)
  })

  it('gives up after maxRetries and rethrows', async () => {
    let attempts = 0
    const factory = () => {
      attempts++
      throw new TypeError('terminated')
    }
    await expect(collect(withStreamRetry(factory, undefined, 2))).rejects.toThrow('terminated')
    expect(attempts).toBe(3) // initial + 2 retries
  })

  it('does not retry when the signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    let attempts = 0
    const factory = () => {
      attempts++
      throw new TypeError('terminated')
    }
    await expect(collect(withStreamRetry(factory, ac.signal))).rejects.toThrow()
    expect(attempts).toBe(1)
  })
})
