import { useState, useEffect, useRef, type ReactNode } from 'react'
import { IconChevronRight, IconChevronDown } from '../icons'

interface Props {
  label: string
  detail: string
  status: 'running' | 'done' | 'error'
  defaultExpanded?: boolean
  collapsible?: boolean
  children?: ReactNode
  actions?: ReactNode
}

const statusConfig = {
  running: { dot: 'bg-[var(--warn)] animate-pulse' },
  done: { dot: 'bg-[var(--good)]' },
  error: { dot: 'bg-[var(--bad)]' },
}

export function ToolCardShell({
  label,
  detail,
  status,
  defaultExpanded = false,
  collapsible = true,
  children,
  actions,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const prevStatus = useRef(status)

  useEffect(() => {
    if (prevStatus.current === 'running' && status !== 'running') {
      setExpanded(false)
    }
    prevStatus.current = status
  }, [status])

  const cfg = statusConfig[status]
  const hasContent = !!children
  const canToggle = collapsible && hasContent && status !== 'running'

  return (
    <div className={`mb-2 border rounded-[8px] bg-[var(--surface-2)] ${status === 'error' ? 'border-[var(--bad)]' : 'border-[var(--border)]'}`}>
      <div
        className={`flex items-center gap-2 px-3 py-2 min-h-[36px] ${canToggle ? 'cursor-pointer hover:bg-[var(--surface-3)]' : ''} transition-colors rounded-t-[8px]`}
        onClick={() => { if (canToggle) setExpanded(!expanded) }}
      >
        <span className={`inline-block h-[6px] w-[6px] rounded-full flex-shrink-0 ${cfg.dot}`} />
        {canToggle && (expanded ? <IconChevronDown size={12} className="text-[var(--muted)]" /> : <IconChevronRight size={12} className="text-[var(--muted)]" />)}
        <span className="text-[12px] font-medium text-[var(--text)]">{label}</span>
        <span className="text-[12px] text-[var(--muted)] truncate flex-1 text-left" style={{ fontFamily: 'var(--font-mono)' }} title={detail}>{detail}</span>
        {actions && <div className="flex items-center gap-1 flex-shrink-0">{actions}</div>}
      </div>
      {(expanded || (status === 'running' && hasContent)) && hasContent && (
        <div className="border-t border-[var(--border)] px-3 py-2">
          {children}
        </div>
      )}
    </div>
  )
}
