import { useState } from 'react'

interface Props { content: string }

export function CompactSummary({ content }: Props) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="mb-3 border border-[#19B5E6]">
      <div className="flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-[0.1em] cursor-pointer hover:bg-[#111]" onClick={() => setExpanded(!expanded)}>
        <span className="text-[#666]">{expanded ? '▼' : '▶'}</span>
        <span className="text-[#19B5E6]">[ CONTEXT SUMMARY ]</span>
      </div>
      {expanded && (
        <div className="border-t border-[#333] px-3 py-2">
          <pre className="max-h-64 overflow-auto text-xs whitespace-pre-wrap text-[#999]">{content}</pre>
        </div>
      )}
    </div>
  )
}
