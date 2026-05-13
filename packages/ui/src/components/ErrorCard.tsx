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
