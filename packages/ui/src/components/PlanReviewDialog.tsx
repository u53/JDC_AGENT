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
    <div className="mb-3 border border-purple-600/50 bg-purple-900/10">
      <div className="flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-[0.1em]">
        <span className="inline-block h-2 w-2 rounded-full bg-purple-400 animate-pulse" />
        <span className="text-purple-400">PLAN REVIEW</span>
        <span className="text-[#666] truncate">{request.planFile.split('/').pop()}</span>
      </div>
      <div className="border-t border-[#333] px-3 py-2 max-h-[300px] overflow-y-auto">
        <pre className="text-xs text-[#EAEAEA] font-mono whitespace-pre-wrap break-all">
          {request.content}
        </pre>
      </div>
      <div className="border-t border-[#333] px-3 py-2">
        {showFeedback && (
          <input
            type="text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Feedback (optional)..."
            className="w-full mb-2 bg-[#111] border border-[#333] px-2 py-1 text-xs text-[#EAEAEA] outline-none focus:border-purple-500"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') respond(false) }}
          />
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={() => respond(true)}
            className="text-[10px] uppercase tracking-[0.05em] text-[#4AF626] hover:text-[#6FFF4A] transition-colors"
          >
            [APPROVE]
          </button>
          <button
            onClick={() => respond(false)}
            className="text-[10px] uppercase tracking-[0.05em] text-[#E61919] hover:text-red-400 transition-colors"
          >
            [REJECT]
          </button>
        </div>
      </div>
    </div>
  )
}
