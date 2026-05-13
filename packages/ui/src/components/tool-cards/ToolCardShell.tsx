import { useState, type ReactNode } from 'react'

interface Props {
  label: string
  labelColor?: string
  detail: string
  status: 'running' | 'done' | 'error'
  borderColor?: string
  defaultExpanded?: boolean
  collapsible?: boolean
  children?: ReactNode
  actions?: ReactNode
}

const statusConfig = {
  running: { text: 'RUNNING', color: 'text-[#EAEAEA]', dot: 'bg-[#4AF626] animate-pulse' },
  done: { text: 'DONE', color: 'text-[#4AF626]', dot: 'bg-[#4AF626]' },
  error: { text: 'ERROR', color: 'text-[#E61919]', dot: 'bg-[#E61919]' },
}

export function ToolCardShell({
  label,
  labelColor = 'text-[#EAEAEA]',
  detail,
  status,
  borderColor = 'border-[#333]',
  defaultExpanded = false,
  collapsible = true,
  children,
  actions,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const cfg = statusConfig[status]
  const hasContent = !!children
  const canToggle = collapsible && hasContent && status !== 'running'

  return (
    <div className={`mb-3 border ${borderColor}`}>
      <div
        className={`flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-[0.1em] ${canToggle ? 'cursor-pointer hover:bg-[#111]' : ''}`}
        onClick={() => { if (canToggle) setExpanded(!expanded) }}
      >
        <span className={`inline-block h-2 w-2 rounded-full ${cfg.dot}`} />
        {canToggle && <span className="text-[#666]">{expanded ? '▼' : '▶'}</span>}
        <span className={labelColor}>{label}</span>
        <span className="text-[#666] truncate flex-1 text-left">{detail}</span>
        <span className={cfg.color}>[{cfg.text}]</span>
        {actions}
      </div>
      {(expanded || status === 'running') && hasContent && (
        <div className="border-t border-[#333] px-3 py-2">
          {children}
        </div>
      )}
    </div>
  )
}
