import { useState, useMemo, useEffect, useRef } from 'react'
import { useTeamStore } from '../stores/team-store'
import { useTeamPolling } from '../hooks/useTeamPolling'

export interface TeamDetailPanelProps {
  sessionId: string
  taskId: string
  onClose?: () => void
}

const QUICK_ACTIONS = [
  { label: '催一下', intent: 'hurry', message: 'Speed up. Stop new exploration and produce results.' },
  { label: '阶段总结', intent: 'request_status', message: 'Provide a concise status update.' },
  { label: '收尾', intent: 'wrap_up', message: 'Stop new tasks. Synthesize from available evidence.' },
  { label: '缩小范围', intent: 'narrow_scope', message: 'Narrow the scope to essentials only.' },
]

export function TeamDetailPanel({ sessionId, taskId, onClose }: TeamDetailPanelProps) {
  useTeamPolling(sessionId, taskId, 1000)
  const team = useTeamStore((s) => s.teams[taskId])
  const eventsMap = useTeamStore((s) => s.events)
  const events = useMemo(() => eventsMap[taskId] ?? [], [eventsMap, taskId])
  const expandedMemberId = useTeamStore((s) => s.expandedMemberId)
  const setExpandedMember = useTeamStore((s) => s.setExpandedMember)
  const [message, setMessage] = useState('')
  const [target, setTarget] = useState<'manager' | 'team'>('manager')
  const [tab, setTab] = useState<'overview' | 'events'>('overview')
  const eventsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length])

  const sendMessage = async (intent: string, content: string) => {
    const api = (window as any).electronAPI
    if (!api?.teamSend) return
    await api.teamSend(sessionId, taskId, { message: content, target, intent })
  }

  const handleSend = async () => {
    const text = message.trim()
    if (!text) return
    await sendMessage('message', text)
    setMessage('')
  }

  if (!team) {
    return (
      <div className="flex flex-col h-full border-l border-[var(--border)] bg-[var(--panel)]">
        <Header title={`Team ${taskId.slice(0, 8)}`} onClose={onClose} />
        <div className="flex-1 flex items-center justify-center text-[12px] text-[var(--muted)]">
          Loading…
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full border-l border-[var(--border)] bg-[var(--panel)]">
      <Header
        title={team.objective}
        status={team.status}
        onClose={onClose}
      />

      <div className="flex border-b border-[var(--border)] px-3 gap-1">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>
          Overview
        </TabButton>
        <TabButton active={tab === 'events'} onClick={() => setTab('events')}>
          Events
          <span className="ml-1.5 text-[10px] opacity-60">{events.length}</span>
        </TabButton>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'overview' ? (
          <div className="p-3 space-y-4">
            <StatsRow team={team} />

            <Section title="Project Manager">
              {team.manager ? (
                <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <div className="text-[13px] text-[var(--text)]">{team.manager.name}</div>
                    <StatusBadge status={team.manager.status} />
                  </div>
                  {team.manager.currentDecision && (
                    <div className="mt-1.5 text-[11px] text-[var(--muted)] italic">
                      {team.manager.currentDecision}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-[11px] text-[var(--muted)]">Initializing…</div>
              )}
            </Section>

            <Section title={`Members (${team.members?.length ?? 0})`}>
              <ul className="space-y-1.5">
                {(team.members ?? []).map((m: any) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    expanded={expandedMemberId === m.id}
                    onToggle={() =>
                      setExpandedMember(expandedMemberId === m.id ? null : m.id)
                    }
                  />
                ))}
              </ul>
            </Section>

            <Section title={`Tasks (${team.taskStats?.completed ?? 0}/${team.taskStats?.total ?? 0})`}>
              <ul className="space-y-1">
                {(team.tasks ?? []).map((t: any) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)]"
                  >
                    <span className="text-[11px] w-3 flex-shrink-0">{taskIcon(t.status)}</span>
                    <span className="flex-1 truncate text-[var(--text)]">{t.title}</span>
                    <StatusBadge status={t.status} small />
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        ) : (
          <div className="p-3">
            <pre className="text-[11px] leading-[1.55] font-mono text-[var(--muted)] whitespace-pre-wrap break-all">
              {events.length === 0 ? '(no events yet)' : events.slice(-200).join('\n')}
            </pre>
            <div ref={eventsEndRef} />
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border)] p-3 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.intent}
              onClick={() => sendMessage(a.intent, a.message)}
              className="text-[11px] px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value as 'manager' | 'team')}
            className="text-[11px] px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="manager">PM</option>
            <option value="team">All</option>
          </select>
          <input
            type="text"
            value={message}
            placeholder="Message team…"
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            className="flex-1 text-[12px] px-2.5 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={handleSend}
            disabled={!message.trim()}
            className="text-[11px] px-3 py-1.5 rounded-md bg-[var(--accent)] text-[var(--bg)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

function Header({
  title,
  status,
  onClose,
}: {
  title: string
  status?: string
  onClose?: () => void
}) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-semibold">
          Team
        </span>
        <span className="text-[13px] text-[var(--text)] truncate">{title}</span>
        {status && <StatusBadge status={status} small />}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Close"
          className="text-[var(--muted)] hover:text-[var(--text)] text-[14px] leading-none px-1.5 py-0.5 rounded hover:bg-[var(--bg)] transition-colors"
        >
          ×
        </button>
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] px-2.5 py-1.5 border-b-2 transition-colors ${
        active
          ? 'border-[var(--accent)] text-[var(--text)]'
          : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
      }`}
    >
      {children}
    </button>
  )
}

function StatsRow({ team }: { team: any }) {
  const ts = team.taskStats ?? {}
  const stats = [
    { label: 'Members', value: team.members?.length ?? 0 },
    { label: 'Done', value: ts.completed ?? 0, color: 'var(--good)' },
    { label: 'Running', value: ts.running ?? 0, color: 'var(--accent)' },
    { label: 'Blocked', value: ts.blocked ?? 0, color: 'var(--warning, orange)' },
    { label: 'Failed', value: ts.failed ?? 0, color: 'var(--bad)' },
  ].filter((s) => s.value > 0)

  return (
    <div className="flex flex-wrap gap-3">
      {stats.map((s) => (
        <div key={s.label} className="text-center">
          <div
            className="text-[16px] font-semibold"
            style={{ color: s.color ?? 'var(--text)' }}
          >
            {s.value}
          </div>
          <div className="text-[10px] text-[var(--muted)] uppercase tracking-wide">
            {s.label}
          </div>
        </div>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-[var(--muted)] font-semibold mb-2">
        {title}
      </div>
      {children}
    </div>
  )
}

function MemberRow({
  member,
  expanded,
  onToggle,
}: {
  member: any
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <li
      className="rounded-md border border-[var(--border)] bg-[var(--bg)] overflow-hidden cursor-pointer hover:border-[var(--accent)]/40 transition-colors"
      onClick={onToggle}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[12px] w-3.5 flex-shrink-0">{statusIcon(member.status)}</span>
        <span className="flex-1 text-[12px] text-[var(--text)] truncate">{member.role}</span>
        <span className="text-[10px] text-[var(--muted)]">
          {member.toolCount > 0 ? `${member.toolCount} tools` : ''}
        </span>
        <StatusBadge status={member.status} small />
      </div>
      {expanded && (
        <div className="border-t border-[var(--border)] px-3 py-2 text-[11px] text-[var(--muted)] space-y-0.5">
          <div>Type: <span className="text-[var(--text)]">{member.agentType}</span></div>
          <div>Task: <span className="text-[var(--text)]">{member.currentTaskId ?? '—'}</span></div>
          <div>Last: <span className="text-[var(--text)]">{new Date(member.lastActivityAt).toLocaleTimeString()}</span></div>
        </div>
      )}
    </li>
  )
}

function StatusBadge({ status, small }: { status: string; small?: boolean }) {
  const colorMap: Record<string, string> = {
    running: 'var(--accent)',
    completed: 'var(--good)',
    failed: 'var(--bad)',
    blocked: 'orange',
    stopped: 'var(--muted)',
    queued: 'var(--muted)',
    planning: 'var(--accent)',
    assigning: 'var(--accent)',
    waiting_for_members: 'var(--accent)',
    reviewing_results: 'var(--accent)',
    handling_intervention: 'orange',
    synthesizing: 'var(--good)',
    todo: 'var(--muted)',
    assigned: 'var(--accent)',
    cancelled: 'var(--muted)',
  }
  const color = colorMap[status] ?? 'var(--muted)'
  const size = small ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'

  return (
    <span
      className={`${size} rounded-full border flex items-center gap-1`}
      style={{ borderColor: color, color }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function statusIcon(status: string): string {
  switch (status) {
    case 'completed': return '✓'
    case 'running': return '●'
    case 'blocked': return '!'
    case 'queued': return '○'
    case 'failed': return '✕'
    case 'stopped': return '⊘'
    default: return '·'
  }
}

function taskIcon(status: string): string {
  switch (status) {
    case 'completed': return '✓'
    case 'running':
    case 'assigned': return '●'
    case 'blocked': return '!'
    case 'todo': return '○'
    case 'cancelled': return '⊘'
    case 'failed': return '✕'
    default: return '·'
  }
}
