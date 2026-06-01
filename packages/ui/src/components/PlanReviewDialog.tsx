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
    <div className="aux-card mb-3" data-tone="plan">
      <div className="aux-card-header">
        <div className="aux-card-title">
          <span className="aux-card-dot is-live" />
          <span className="aux-card-label">PLAN REVIEW</span>
          <span className="aux-card-muted truncate">{request.planFile.split('/').pop()}</span>
        </div>
      </div>
      <div className="aux-card-body max-h-[300px] overflow-y-auto">
        <pre className="text-xs text-[var(--text)] whitespace-pre-wrap break-all" style={{ fontFamily: 'var(--font-mono)' }}>
          {request.content}
        </pre>
      </div>
      <div className="aux-card-body">
        {showFeedback && (
          <input
            type="text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Feedback (optional)..."
            className="w-full mb-2 bg-[var(--surface-2)] border border-[var(--border)] rounded-[6px] px-2 py-1 text-xs text-[var(--text)] outline-none focus:border-[var(--plan)]"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') respond(false) }}
          />
        )}
        <div className="aux-card-actions">
          <button
            onClick={() => respond(true)}
            className="aux-card-action is-good"
          >
            Approve
          </button>
          <button
            onClick={() => respond(false)}
            className="aux-card-action is-danger"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  )
}
