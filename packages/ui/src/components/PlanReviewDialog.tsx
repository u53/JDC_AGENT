import { useEffect, useState } from 'react'

interface PlanReviewRequest {
  id: string
  sessionId: string
  planFile: string
  content: string
}

interface Props {
  sessionId: string | null
}

export function PlanReviewDialog({ sessionId }: Props) {
  const [request, setRequest] = useState<PlanReviewRequest | null>(null)
  const [feedback, setFeedback] = useState('')
  const [showFeedback, setShowFeedback] = useState(false)

  useEffect(() => {
    if (!window.electronAPI) return
    return window.electronAPI.on('plan:review', (_e: unknown, data: unknown) => {
      setRequest(data as PlanReviewRequest)
      setFeedback('')
      setShowFeedback(false)
    })
  }, [])

  if (!request || request.sessionId !== sessionId) return null

  const respond = (approved: boolean) => {
    if (!approved && !showFeedback) {
      setShowFeedback(true)
      return
    }
    ;(window as any).electronAPI.planRespond(request.id, approved, feedback || undefined)
    setRequest(null)
  }

  return (
    <div className="mb-3 border border-[var(--border)] bg-[var(--surface-2)] border-l-4 border-l-[var(--plan)] rounded-[8px]">
      <div className="flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-[0.1em]">
        <span className="inline-block h-2 w-2 rounded-full bg-[var(--plan)] animate-pulse" />
        <span className="text-[var(--plan)]">PLAN REVIEW</span>
        <span className="text-[var(--muted)] truncate">{request.planFile.split('/').pop()}</span>
      </div>
      <div className="border-t border-[var(--border)] px-3 py-2 max-h-[300px] overflow-y-auto">
        <pre className="text-xs text-[var(--text)] whitespace-pre-wrap break-all" style={{ fontFamily: 'var(--font-mono)' }}>
          {request.content}
        </pre>
      </div>
      <div className="border-t border-[var(--border)] px-3 py-2">
        {showFeedback && (
          <input
            type="text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Feedback (optional)..."
            className="w-full mb-2 bg-[var(--surface-2)] border border-[var(--border)] px-2 py-1 text-xs text-[var(--text)] outline-none focus:border-[var(--plan)]"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') respond(false) }}
          />
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={() => respond(true)}
            className="text-[12px] text-[var(--good)] hover:opacity-80 transition-colors"
          >
            Approve
          </button>
          <button
            onClick={() => respond(false)}
            className="text-[12px] text-[var(--bad)] hover:opacity-80 transition-colors"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  )
}
