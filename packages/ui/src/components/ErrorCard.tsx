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
    <div className="mb-3 border border-[var(--border)] bg-[var(--surface-2)] border-l-4 border-l-[var(--bad)] rounded-[8px]">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.1em]">
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--bad)]" />
          <span className="text-[var(--bad)]">{categoryLabels[category] || 'ERROR'}</span>
          {retrying && retryAttempt && (
            <span className="text-[var(--muted)]">Retry #{retryAttempt}{countdown > 0 ? ` in ${countdown}s` : '...'}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!retrying && (
            <button
              onClick={onRetry}
              className="text-[12px] text-[var(--good)] hover:opacity-80 transition-colors"
            >
              Retry
            </button>
          )}
          <button
            onClick={onDismiss}
            className="text-[12px] text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
      <div className="border-t border-[var(--border)] px-3 py-2">
        <pre className="text-xs text-[var(--bad)] whitespace-pre-wrap">{message}</pre>
      </div>
    </div>
  )
}
