import { useState, useEffect } from 'react'

interface Props {
  message: string
  category: string
  retrying: boolean
  retryAttempt?: number
  retryMaxRetries?: number
  retryIn?: number
  onRetry: () => void
  onCancel?: () => void
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

export function ErrorCard({ message, category, retrying, retryAttempt, retryMaxRetries, retryIn, onRetry, onCancel, onDismiss }: Props) {
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

  const retryProgress = retryAttempt
    ? retryMaxRetries
      ? `${retryAttempt}/${retryMaxRetries}`
      : `#${retryAttempt}`
    : null

  return (
    <div className="aux-card mb-3" data-tone="bad">
      <div className="aux-card-header">
        <div className="aux-card-title">
          <span className="aux-card-dot" />
          <span className="aux-card-label">{categoryLabels[category] || 'ERROR'}</span>
          {retrying && retryProgress && (
            <span className="aux-card-muted">
              Retrying {retryProgress}
              {countdown > 0 ? ` · next attempt in ${countdown}s` : ' · retrying now'}
            </span>
          )}
        </div>
        <div className="aux-card-actions">
          {retrying ? (
            onCancel && (
              <button
                onClick={onCancel}
                className="aux-card-action"
              >
                Cancel
              </button>
            )
          ) : (
            <>
              <button
                onClick={onRetry}
                className="aux-card-action is-good"
              >
                Retry
              </button>
              <button
                onClick={onDismiss}
                className="aux-card-action"
              >
                Dismiss
              </button>
            </>
          )}
        </div>
      </div>
      <div className="aux-card-body">
        <pre className="text-xs text-[var(--bad)] whitespace-pre-wrap">{message}</pre>
      </div>
    </div>
  )
}
