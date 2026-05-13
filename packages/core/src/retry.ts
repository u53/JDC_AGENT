export interface RetryOptions {
  maxRetries?: number
  signal?: AbortSignal
  onRetry?: (attempt: number, error: Error, delayMs: number) => void
}

export type ErrorCategory = 'rate_limit' | 'overloaded' | 'gateway' | 'network' | 'prompt_too_long' | 'non_retryable'

export function classifyError(error: any): ErrorCategory {
  const status = error?.status || error?.statusCode
  const message = error?.message || String(error)

  if (status === 429) return 'rate_limit'
  if (status === 529) return 'overloaded'
  if (status === 502 || status === 503 || status === 504) return 'gateway'
  if (message.includes('prompt is too long') || message.includes('prompt_too_long') || message.includes('maximum context length')) return 'prompt_too_long'
  if (message.includes('ECONNRESET') || message.includes('EPIPE') || message.includes('ETIMEDOUT') || message.includes('socket hang up') || message.includes('network')) return 'network'
  if (status === 400 || status === 401 || status === 403 || status === 422) return 'non_retryable'

  return 'non_retryable'
}

export function getMaxRetries(category: ErrorCategory): number {
  switch (category) {
    case 'rate_limit': return 5
    case 'overloaded': return 3
    case 'gateway': return 3
    case 'network': return 2
    case 'prompt_too_long': return 0
    case 'non_retryable': return 0
  }
}

export function getRetryDelay(attempt: number, category: ErrorCategory, error?: any): number {
  if (category === 'rate_limit') {
    const retryAfter = error?.headers?.['retry-after']
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10)
      if (!isNaN(seconds)) return seconds * 1000
    }
  }

  if (category === 'network') return 1000

  const baseDelay = 1000
  const maxDelay = 30000
  const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
  const jitter = delay * 0.1 * Math.random()
  return delay + jitter
}
