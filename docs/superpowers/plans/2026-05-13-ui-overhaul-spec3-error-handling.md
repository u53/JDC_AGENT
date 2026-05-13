# Error Handling + Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic retry with exponential backoff for transient API errors, rate limit handling, and user-visible error cards with manual retry capability.

**Architecture:** A `withRetry` wrapper around provider stream calls handles transient errors with exponential backoff. Enhanced error events flow to the frontend where an ErrorCard displays status and retry controls.

**Tech Stack:** TypeScript, React 19, Zustand, TailwindCSS 4

---

## File Structure

```
packages/core/src/retry.ts                    — withRetry logic, error classification
packages/core/src/session.ts                  — integrate retry in runLoop
packages/core/tests/retry.test.ts             — unit tests for retry logic

packages/ui/src/components/ErrorCard.tsx       — error display component
packages/ui/src/components/ChatView.tsx        — integrate ErrorCard, retry button
packages/ui/src/stores/session-store.ts       — add error state
packages/ui/src/hooks/useSession.ts           — expose error + retry
```

---

## Task 1: Core retry utility

**Files:**
- Create: `packages/core/src/retry.ts`
- Create: `packages/core/tests/retry.test.ts`

- [ ] **Step 1: Create retry.ts**

Create `packages/core/src/retry.ts`:

```typescript
export interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
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

export function getRetryDelay(attempt: number, category: ErrorCategory, error: any): number {
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

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 3, signal, onRetry } = opts
  let lastError: any

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new Error('Request was aborted.')

    try {
      return await fn()
    } catch (error: any) {
      lastError = error
      const category = classifyError(error)
      const maxForCategory = getMaxRetries(category)

      if (category === 'non_retryable' || category === 'prompt_too_long' || attempt >= maxForCategory) {
        throw error
      }

      const delay = getRetryDelay(attempt, category, error)
      onRetry?.(attempt + 1, error, delay)

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay)
        signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('Request was aborted.'))
        }, { once: true })
      })
    }
  }

  throw lastError
}
```

- [ ] **Step 2: Create retry.test.ts**

Create `packages/core/tests/retry.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { classifyError, getMaxRetries, getRetryDelay, withRetry } from '../src/retry.js'

describe('classifyError', () => {
  it('classifies 429 as rate_limit', () => {
    expect(classifyError({ status: 429 })).toBe('rate_limit')
  })
  it('classifies 529 as overloaded', () => {
    expect(classifyError({ status: 529 })).toBe('overloaded')
  })
  it('classifies 502/503/504 as gateway', () => {
    expect(classifyError({ status: 502 })).toBe('gateway')
    expect(classifyError({ status: 503 })).toBe('gateway')
    expect(classifyError({ status: 504 })).toBe('gateway')
  })
  it('classifies ECONNRESET as network', () => {
    expect(classifyError({ message: 'ECONNRESET' })).toBe('network')
  })
  it('classifies prompt_too_long', () => {
    expect(classifyError({ message: 'prompt is too long' })).toBe('prompt_too_long')
  })
  it('classifies 401 as non_retryable', () => {
    expect(classifyError({ status: 401 })).toBe('non_retryable')
  })
})

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await withRetry(fn)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on gateway error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ status: 502, message: 'Bad Gateway' })
      .mockResolvedValue('ok')
    const result = await withRetry(fn, { maxRetries: 3 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 401, message: 'Unauthorized' })
    await expect(withRetry(fn)).rejects.toMatchObject({ status: 401 })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('calls onRetry callback', async () => {
    const onRetry = vi.fn()
    const fn = vi.fn()
      .mockRejectedValueOnce({ status: 503, message: 'Unavailable' })
      .mockResolvedValue('ok')
    await withRetry(fn, { maxRetries: 3, onRetry })
    expect(onRetry).toHaveBeenCalledWith(1, expect.anything(), expect.any(Number))
  })

  it('respects abort signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const fn = vi.fn().mockRejectedValue({ status: 502, message: 'err' })
    await expect(withRetry(fn, { signal: controller.signal })).rejects.toThrow('aborted')
  })
})
```

- [ ] **Step 3: Run tests**

Run: `cd packages/core && pnpm test -- --run retry`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/retry.ts packages/core/tests/retry.test.ts
git commit -m "feat(core): add withRetry utility with error classification and exponential backoff"
```

---

## Task 2: Integrate retry into Session.runLoop

**Files:**
- Modify: `packages/core/src/session.ts`

- [ ] **Step 1: Import retry utilities**

Add at top of session.ts:
```typescript
import { withRetry, classifyError, type ErrorCategory } from './retry.js'
```

- [ ] **Step 2: Add enhanced error event to SessionEvents**

Update `SessionEvents` to include retry info:
```typescript
export interface SessionEvents {
  onStreamChunk: (chunk: StreamChunk) => void
  onToolEvent: (event: ToolExecutionEvent) => void
  onMessageComplete: (message: Message) => void
  onError: (error: Error) => void
  onRetrying?: (attempt: number, error: Error, delayMs: number, category: string) => void
  onAgentProgress?: (agentToolUseId: string, event: any) => void
  onAgentText?: (agentToolUseId: string, text: string) => void
  onAgentComplete?: (agentToolUseId: string, result: any) => void
}
```

- [ ] **Step 3: Wrap the stream call in withRetry**

In `runLoop`, the current stream call is:
```typescript
const stream = this.provider.stream(this.messages, toolDefs, config, this.abortController!.signal)
```

Wrap it:
```typescript
const streamFn = () => this.provider.stream(this.messages, toolDefs, config, this.abortController!.signal)

let stream: AsyncIterable<StreamChunk>
try {
  stream = await withRetry(
    async () => streamFn(),
    {
      signal: this.abortController!.signal,
      onRetry: (attempt, error, delayMs) => {
        const category = classifyError(error)
        events.onRetrying?.(attempt, error, delayMs, category)
      },
    }
  )
} catch (err: any) {
  const category = classifyError(err)
  if (category === 'prompt_too_long') {
    await this.compactNow(events)
    continue
  }
  events.onError(err)
  break
}
```

Note: `provider.stream` returns an AsyncIterable, not a Promise. The retry should wrap the initial connection, not each chunk. Since `stream()` is an async generator, calling it creates the stream (which may throw on connection). We need to handle this carefully:

Actually, for async generators, the error happens when we iterate (first `next()` call), not when we call `stream()`. So the retry needs to wrap the first iteration attempt. A simpler approach: wrap the entire stream consumption in a retry loop at the `runLoop` level.

Better approach — retry at the `for await` level:

```typescript
let streamSuccess = false
let retryCount = 0
const maxRetries = 5

while (!streamSuccess && retryCount <= maxRetries) {
  try {
    const stream = this.provider.stream(this.messages, toolDefs, config, this.abortController!.signal)
    for await (const chunk of stream) {
      // ... existing chunk handling ...
    }
    streamSuccess = true
  } catch (streamErr: any) {
    const category = classifyError(streamErr)
    if (category === 'non_retryable') {
      events.onError(streamErr)
      return // exit runLoop entirely
    }
    if (category === 'prompt_too_long') {
      await this.compactNow(events)
      break // break inner retry, continue outer runLoop
    }
    const maxForCategory = getMaxRetries(category)
    if (retryCount >= maxForCategory) {
      events.onError(streamErr)
      return
    }
    const delay = getRetryDelay(retryCount, category, streamErr)
    events.onRetrying?.(retryCount + 1, streamErr, delay, category)
    await new Promise(r => setTimeout(r, delay))
    retryCount++
  }
}
```

This replaces the current try-catch around the stream iteration.

- [ ] **Step 4: Add getRetryDelay import**

```typescript
import { withRetry, classifyError, getMaxRetries, getRetryDelay, type ErrorCategory } from './retry.js'
```

- [ ] **Step 5: Run tests**

Run: `cd packages/core && pnpm test -- --run agent`
Expected: Pass

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/session.ts
git commit -m "feat(core): integrate retry with exponential backoff into session runLoop"
```

---

## Task 3: IPC retry events and session-manager

**Files:**
- Modify: `packages/electron/src/session-manager.ts`
- Modify: `packages/electron/src/ipc-channels.ts`

- [ ] **Step 1: Add IPC channel**

In `ipc-channels.ts`:
```typescript
QUERY_RETRYING: 'query:retrying',
```

- [ ] **Step 2: Forward retry event in session-manager**

In the `events` object in `sendMessage`, add:
```typescript
onRetrying: (attempt: number, error: Error, delayMs: number, category: string) => {
  this.window?.webContents.send('query:retrying', {
    sessionId,
    attempt,
    error: error.message,
    delayMs,
    category,
  })
},
```

- [ ] **Step 3: Build**

Run: `cd packages/core && pnpm build && cd ../electron && pnpm build`

- [ ] **Step 4: Commit**

```bash
git add packages/electron/src/session-manager.ts packages/electron/src/ipc-channels.ts
git commit -m "feat(electron): forward retry events via IPC"
```

---

## Task 4: Frontend error state and ErrorCard

**Files:**
- Modify: `packages/ui/src/stores/session-store.ts`
- Create: `packages/ui/src/components/ErrorCard.tsx`
- Modify: `packages/ui/src/hooks/useSession.ts`
- Modify: `packages/ui/src/lib/ipc-client.ts`

- [ ] **Step 1: Add error state to session store**

In `packages/ui/src/stores/session-store.ts`, add to `SessionStreamState`:
```typescript
export interface SessionStreamState {
  isStreaming: boolean
  streamingText: string
  thinkingText: string
  isThinking: boolean
  toolEvents: ToolExecutionEvent[]
  error?: { message: string; category: string; retrying: boolean; retryAttempt?: number; retryIn?: number }
}
```

Add store methods:
```typescript
setError: (sessionId: string, error: { message: string; category: string; retrying: boolean; retryAttempt?: number; retryIn?: number } | null) => void
```

Implementation:
```typescript
setError: (sessionId, error) => set((s) => {
  const current = s.sessionStates[sessionId] || EMPTY_STREAM_STATE
  return {
    sessionStates: {
      ...s.sessionStates,
      [sessionId]: { ...current, error: error || undefined },
    },
  }
}),
```

- [ ] **Step 2: Add IPC listeners for retry and enhanced error**

In `packages/ui/src/lib/ipc-client.ts`, add to `ipc.query`:
```typescript
onRetrying: (cb: (data: { sessionId: string; attempt: number; error: string; delayMs: number; category: string }) => void) =>
  on('query:retrying', (_e, data) => cb(data as any)),
```

In `packages/ui/src/hooks/useSession.ts`, add listeners:
```typescript
const unsubRetrying = ipc.query.onRetrying(({ sessionId, attempt, error, delayMs, category }) => {
  store.setError(sessionId, { message: error, category, retrying: true, retryAttempt: attempt, retryIn: delayMs })
})

// Update unsubError to set error state:
const unsubError = ipc.query.onError(({ sessionId, error }) => {
  store.clearSessionStreamState(sessionId)
  store.setError(sessionId, { message: error, category: 'unknown', retrying: false })
})
```

Add `unsubRetrying` to the cleanup return.

- [ ] **Step 3: Expose error and retry in useSession return**

In `useSession.ts`, add to the return:
```typescript
error: currentState.error,
retry: useCallback(() => {
  if (!activeSessionId) return
  useSessionStore.getState().setError(activeSessionId, null)
  // Re-send the last user message
  const msgs = useSessionStore.getState().messages
  const lastUser = [...msgs].reverse().find(m => m.role === 'user')
  if (lastUser) {
    const textBlock = lastUser.content.find((b: any) => b.type === 'text') as any
    if (textBlock?.text) {
      sendMessage(textBlock.text)
    }
  }
}, [activeSessionId, sendMessage]),
```

- [ ] **Step 4: Create ErrorCard.tsx**

Create `packages/ui/src/components/ErrorCard.tsx`:

```typescript
import { useState, useEffect } from 'react'

interface Props {
  message: string
  category: string
  retrying: boolean
  retryAttempt?: number
  retryIn?: number
  onRetry: () => void
  onDismiss: () => void
}

const categoryLabels: Record<string, string> = {
  rate_limit: 'RATE LIMITED',
  overloaded: 'SERVER OVERLOADED',
  gateway: 'GATEWAY ERROR',
  network: 'NETWORK ERROR',
  prompt_too_long: 'CONTEXT TOO LONG',
  unknown: 'ERROR',
}

export function ErrorCard({ message, category, retrying, retryAttempt, retryIn, onRetry, onDismiss }: Props) {
  const [countdown, setCountdown] = useState(retryIn ? Math.ceil(retryIn / 1000) : 0)

  useEffect(() => {
    if (!retrying || !retryIn) return
    setCountdown(Math.ceil(retryIn / 1000))
    const interval = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(interval); return 0 }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [retrying, retryIn])

  return (
    <div className="mb-3 border border-[#E61919]/50 bg-[#E61919]/5">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.1em]">
          <span className="inline-block h-2 w-2 rounded-full bg-[#E61919]" />
          <span className="text-[#E61919]">{categoryLabels[category] || 'ERROR'}</span>
          {retrying && retryAttempt && (
            <span className="text-[#666]">Retry #{retryAttempt}{countdown > 0 ? ` in ${countdown}s` : '...'}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!retrying && (
            <button
              onClick={onRetry}
              className="text-[10px] uppercase tracking-[0.05em] text-[#4AF626] hover:text-[#6FFF4A] transition-colors"
            >
              [RETRY]
            </button>
          )}
          <button
            onClick={onDismiss}
            className="text-[10px] uppercase tracking-[0.05em] text-[#666] hover:text-[#EAEAEA] transition-colors"
          >
            [X]
          </button>
        </div>
      </div>
      <div className="border-t border-[#333] px-3 py-2">
        <pre className="text-xs text-[#E61919] whitespace-pre-wrap">{message}</pre>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Integrate ErrorCard in ChatView**

In `ChatView.tsx`, import ErrorCard and useSession's error/retry:
```typescript
import { ErrorCard } from './ErrorCard'
```

After the streaming indicators section, add:
```typescript
{error && (
  <ErrorCard
    message={error.message}
    category={error.category}
    retrying={error.retrying}
    retryAttempt={error.retryAttempt}
    retryIn={error.retryIn}
    onRetry={retry}
    onDismiss={() => useSessionStore.getState().setError(activeSessionId!, null)}
  />
)}
```

Add `error` and `retry` to the useSession destructuring.

- [ ] **Step 6: Verify build**

Run: `cd packages/ui && npx vite build`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/stores/session-store.ts packages/ui/src/components/ErrorCard.tsx packages/ui/src/hooks/useSession.ts packages/ui/src/lib/ipc-client.ts packages/ui/src/components/ChatView.tsx
git commit -m "feat(ui): add ErrorCard with retry countdown and manual retry button"
```

---

## Task 5: Integration test

**Files:** None (manual testing)

- [ ] **Step 1: Build all**

```bash
cd packages/core && pnpm build && cd ../electron && pnpm build
```

- [ ] **Step 2: Start app and test**

Test scenarios:
1. Normal message → should work as before
2. Disconnect network → should show NETWORK ERROR card
3. Send very long context → should auto-compact and retry
4. Rate limit (if testable) → should show countdown

- [ ] **Step 3: Commit fixes**

```bash
git add -A
git commit -m "fix: address error handling issues found in testing"
```
