import { useState, useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
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
  running: { label: 'RUNNING', dot: 'bg-[var(--warn)]' },
  done: { label: 'DONE', dot: 'bg-[var(--good)]' },
  error: { label: 'ERROR', dot: 'bg-[var(--bad)]' },
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
  const showContent = (expanded || (status === 'running' && hasContent)) && hasContent

  const toggle = () => {
    if (canToggle) setExpanded(!expanded)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!canToggle) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggle()
    }
  }

  return (
    <div className="jdc-event-card mb-2" data-status={status} data-expanded={showContent ? 'true' : 'false'}>
      <div className="jdc-event-rail" aria-hidden="true" />
      <div
        className={`jdc-event-card-header ${canToggle ? 'is-toggleable' : ''}`}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        role={canToggle ? 'button' : undefined}
        tabIndex={canToggle ? 0 : undefined}
        aria-expanded={canToggle ? expanded : undefined}
      >
        <span className="jdc-event-status" aria-hidden="true">
          <span className={`jdc-event-dot ${cfg.dot}`} />
          {status === 'running' && (
            <span className="jdc-event-bars">
              <span />
              <span />
              <span />
            </span>
          )}
        </span>
        {canToggle && (
          <span className="jdc-event-chevron">
            {expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          </span>
        )}
        <span className="jdc-event-label">{label}</span>
        <span className="jdc-event-detail" title={detail}>{detail}</span>
        <span className="jdc-event-chip">{cfg.label}</span>
        {actions && <div className="flex items-center gap-1 flex-shrink-0">{actions}</div>}
      </div>
      {showContent && (
        <div className="jdc-event-content">
          {children}
        </div>
      )}
    </div>
  )
}
