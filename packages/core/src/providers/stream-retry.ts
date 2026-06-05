import type { StreamChunk } from '../types.js'
import { DEFAULT_RETRYABLE_MAX_RETRIES } from '../retry.js'

export type StreamRetryCallback = (
  attempt: number,
  error: Error,
  delayMs: number,
  maxRetries: number,
) => void

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

/**
 * Decide whether a streaming failure is a transient network/server hiccup that
 * is safe to retry. Covers undici socket errors (the bare `terminated` message
 * undici throws when the connection is closed mid-read), the OpenAI SDK's
 * APIConnectionError wrapper, and retryable HTTP statuses. Never treats a
 * user-initiated abort as retryable.
 *
 * Provider-agnostic: works for the Anthropic raw-fetch path and both OpenAI
 * SDK paths (chat completions + responses).
 */
export function isRetryableStreamError(err: unknown): boolean {
  if (!err) return false
  const e = err as any
  if (e.name === 'AbortError' || e.name === 'APIUserAbortError') return false

  // HTTP status — present as a numeric prefix in the Anthropic raw path
  // (`${status} ${body}`) or as `.status` on OpenAI SDK errors. Retry on
  // 408/409/429 and all 5xx (incl. Anthropic 529 overloaded).
  const explicitStatus = typeof e?.status === 'number' ? e.status : undefined
  const msg = String(e?.message ?? e)
  const statusMatch = /^\s*(\d{3})\b/.exec(msg)
  const code = explicitStatus ?? (statusMatch ? Number(statusMatch[1]) : undefined)
  if (code !== undefined) {
    return code === 408 || code === 409 || code === 429 || code >= 500
  }

  // The OpenAI SDK wraps socket failures in APIConnectionError; treat any
  // connection-class error as retryable regardless of message wording.
  if (e?.name === 'APIConnectionError' || e?.name === 'APIConnectionTimeoutError') return true

  // Network / socket errors. undici nests the real cause, so scan the chain.
  const haystack = [msg, e?.code, e?.cause?.message, e?.cause?.code]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return /terminated|econnreset|etimedout|epipe|eai_again|socket hang up|other side closed|und_err|fetch failed|network/.test(haystack)
}

/**
 * Wrap a stream-producing factory with retry-before-first-chunk semantics.
 *
 * A streaming response cannot be resumed once it has emitted content (neither
 * Anthropic SSE nor OpenAI streams support replay), so we only retry when the
 * failure happens BEFORE the first chunk is yielded downstream — i.e. connect
 * failures, retryable HTTP statuses, or a socket dropped during the initial
 * handshake. If the stream dies mid-flight, the error is surfaced to the caller.
 *
 * `makeStream` is called once per attempt and must establish a fresh request.
 */
export async function* withStreamRetry(
  makeStream: () => AsyncIterable<StreamChunk>,
  signal?: AbortSignal,
  maxRetries = DEFAULT_RETRYABLE_MAX_RETRIES,
  onRetry?: StreamRetryCallback,
): AsyncIterable<StreamChunk> {
  for (let attempt = 0; ; attempt++) {
    let yieldedAny = false
    try {
      for await (const chunk of makeStream()) {
        yieldedAny = true
        yield chunk
      }
      return
    } catch (err) {
      if (yieldedAny || signal?.aborted || attempt >= maxRetries || !isRetryableStreamError(err)) {
        throw err
      }
      // Exponential backoff with jitter: ~500ms, ~1000ms.
      const delay = 500 * 2 ** attempt + Math.floor(Math.random() * 250)
      onRetry?.(attempt + 1, toError(err), delay, maxRetries)
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, delay)
        signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
      })
    }
  }
}
