import { useState } from 'react'

interface Props { content: string }

export function CompactSummary({ content }: Props) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="aux-card jdc-compact-summary mb-3" data-tone="accent">
      <button className="aux-card-header cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <span className="aux-card-dot" />
        <span className="aux-card-caret">{expanded ? '▼' : '▶'}</span>
        <span className="jdc-compact-copy">
          <span className="aux-card-label">压缩摘要</span>
          <span className="aux-card-muted">已隐藏早期长对话，模型会继续使用这份恢复上下文</span>
        </span>
        <span className="aux-card-chip">恢复上下文</span>
      </button>
      {expanded && (
        <div className="aux-card-body">
          <pre className="max-h-64 overflow-auto text-xs whitespace-pre-wrap text-[var(--muted)]">{content}</pre>
        </div>
      )}
    </div>
  )
}
