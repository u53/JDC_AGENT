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
    <div className="aux-card mb-3" data-tone="bad">
      <div className="aux-card-header">
        <div className="aux-card-title">
          <span className="aux-card-dot" />
          <span className="aux-card-label">{categoryLabels[category] || 'ERROR'}</span>
          {retrying && retryAttempt && (
            <span className="aux-card-muted">Retry #{retryAttempt}{countdown > 0 ? ` in ${countdown}s` : '...'}</span>
          )}
        </div>
        <div className="aux-card-actions">
          {!retrying && (
            <button
              onClick={onRetry}
              className="aux-card-action is-good"
            >
              Retry
            </button>
          )}
          <button
            onClick={onDismiss}
            className="aux-card-action"
          >
            Dismiss
          </button>
        </div>
      </div>
      <div className="aux-card-body">
        <pre className="text-xs text-[var(--bad)] whitespace-pre-wrap">{message}</pre>
      </div>
    </div>
  )
}
