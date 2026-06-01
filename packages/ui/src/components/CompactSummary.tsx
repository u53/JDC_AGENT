import { useState } from 'react'

interface Props { content: string }

export function CompactSummary({ content }: Props) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="aux-card mb-3" data-tone="accent">
      <div className="aux-card-header cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <span className="aux-card-dot" />
        <span className="aux-card-caret">{expanded ? '▼' : '▶'}</span>
        <span className="aux-card-label">CONTEXT SUMMARY</span>
      </div>
      {expanded && (
        <div className="aux-card-body">
          <pre className="max-h-64 overflow-auto text-xs whitespace-pre-wrap text-[var(--muted)]">{content}</pre>
        </div>
      )}
    </div>
  )
}
