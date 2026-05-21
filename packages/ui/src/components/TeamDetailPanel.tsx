import { useState, useMemo, useEffect, useRef } from 'react'
import { useTeamStore, type TeamConversationEntry } from '../stores/team-store'
import { useToastStore } from '../stores/toast-store'

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
  // Polling is now handled globally by GlobalTeamPoller — no per-panel polling needed
  const team = useTeamStore((s) => s.teams[taskId])
  const eventsMap = useTeamStore((s) => s.events)
  const events = useMemo(() => eventsMap[taskId] ?? [], [eventsMap, taskId])
  const conversationMap = useTeamStore((s) => s.conversations)
  const conversation = useMemo(() => conversationMap[taskId] ?? [], [conversationMap, taskId])
  const appendConversation = useTeamStore((s) => s.appendConversation)
  const updateConversation = useTeamStore((s) => s.updateConversation)
  const expandedMemberId = useTeamStore((s) => s.expandedMemberId)
  const setExpandedMember = useTeamStore((s) => s.setExpandedMember)
  const showToast = useToastStore((s) => s.showToast)

  const [message, setMessage] = useState('')
  const [tab, setTab] = useState<'overview' | 'events'>('overview')
  const [sending, setSending] = useState(false)
  const [justSent, setJustSent] = useState(false)
  const [activeQuickAction, setActiveQuickAction] = useState<string | null>(null)
  const eventsEndRef = useRef<HTMLDivElement>(null)
  const conversationEndRef = useRef<HTMLDivElement>(null)

  const isFinished = team?.status === 'completed' || team?.status === 'failed' || team?.finished === true

  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length])

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation.length])

  const sendMessage = async (intent: string, content: string) => {
    if (isFinished) return
    const api = (window as any).electronAPI
    if (!api?.teamSend) return

    const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

    appendConversation(taskId, {
      id: localId,
      direction: 'sent',
      from: 'user',
      intent,
      content,
      timestamp: Date.now(),
      status: 'sending',
    })

    setActiveQuickAction(intent)
    setTimeout(() => setActiveQuickAction(null), 600)

    try {
      const result = await api.teamSend(sessionId, taskId, { message: content, target: 'manager', intent })
      if (result?.success === false) {
        updateConversation(taskId, localId, { status: 'failed' })
        showToast('Failed to send message', 'error')
      } else {
        updateConversation(taskId, localId, { status: 'delivered' })
        showToast('Sent to PM', 'success')
      }
    } catch (err) {
      updateConversation(taskId, localId, { status: 'failed' })
      showToast(err instanceof Error ? err.message : 'Send failed', 'error')
    }
  }

  const handleSend = async () => {
    const text = message.trim()
    if (!text || sending || isFinished) return
    setSending(true)
    try {
      await sendMessage('message', text)
      setMessage('')
      setJustSent(true)
      setTimeout(() => setJustSent(false), 1200)
    } finally {
      setSending(false)
    }
  }

  if (!team) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-[var(--panel)]">
        <Header title={`Team ${taskId.slice(0, 8)}`} onClose={onClose} />
        <div className="flex-1 flex items-center justify-center text-[12px] text-[var(--muted)]">
          Loading…
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--panel)]">
      <Header
        title={team.objective}
        status={team.status}
        onClose={onClose}
      />

      <div className="flex-shrink-0 flex border-b border-[var(--border)] px-3 gap-1">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>
          Overview
        </TabButton>
        <TabButton active={tab === 'events'} onClick={() => setTab('events')}>
          Events
          <span className="ml-1.5 text-[10px] opacity-60">{events.length}</span>
        </TabButton>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
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

            {conversation.length > 0 && (
              <Section title={`Conversation (${conversation.length})`}>
                <ul className="space-y-1.5">
                  {conversation.slice(-50).map((entry) => (
                    <ConversationBubble key={entry.id} entry={entry} />
                  ))}
                </ul>
                <div ref={conversationEndRef} />
              </Section>
            )}
          </div>
        ) : (
          <div className="h-full flex flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              <pre className="text-[11px] leading-[1.55] font-mono text-[var(--muted)] whitespace-pre-wrap break-all m-0">
                {events.length === 0 ? '(no events yet)' : events.slice(-200).join('\n')}
              </pre>
              <div ref={eventsEndRef} />
            </div>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 border-t border-[var(--border)] p-3 space-y-2">
        {isFinished && (
          <div className="text-[10px] text-[var(--muted)] italic px-1">
            Team has {team.status}. Messages are disabled.
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_ACTIONS.map((a) => {
            const isActive = activeQuickAction === a.intent
            return (
              <button
                key={a.intent}
                disabled={isFinished}
                onClick={() => sendMessage(a.intent, a.message)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-all duration-150 ${
                  isActive
                    ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-soft)] scale-95'
                    : 'border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[var(--border)] disabled:hover:text-[var(--text)]`}
              >
                {a.label}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className={`text-[11px] px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)] flex items-center gap-1 ${
              isFinished ? 'opacity-40' : ''
            }`}
            title="Messages are routed through the Project Manager. Tell the PM what you want and it will broadcast or assign as needed."
          >
            <span className="text-[10px]">→</span>
            <span>PM</span>
          </div>
          <input
            type="text"
            value={message}
            placeholder={isFinished ? 'Team finished' : 'Message PM…'}
            disabled={isFinished}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            className="flex-1 text-[12px] px-2.5 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-40 disabled:cursor-not-allowed"
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || sending || isFinished}
            className={`text-[11px] px-3 py-1.5 rounded-md transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
              justSent
                ? 'bg-[var(--good)] text-[var(--bg)]'
                : 'bg-[var(--accent)] text-[var(--bg)] hover:opacity-90'
            }`}
          >
            {sending ? 'Sending…' : justSent ? '✓ Sent' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ConversationBubble({ entry }: { entry: TeamConversationEntry }) {
  const isSent = entry.direction === 'sent'
  const intentColor: Record<string, string> = {
    hurry: 'var(--warn)',
    wrap_up: 'var(--bad)',
    request_status: 'var(--accent)',
    narrow_scope: 'var(--accent)',
    question: 'var(--warn)',
    finding: 'var(--good)',
  }
  const tagColor = intentColor[entry.intent] ?? 'var(--muted)'
  const statusIcon = entry.status === 'sending' ? '⏳' : entry.status === 'failed' ? '✕' : '✓'
  const statusColor = entry.status === 'sending' ? 'var(--muted)' : entry.status === 'failed' ? 'var(--bad)' : 'var(--good)'

  const fromLabel = isSent ? 'You' : entry.from === 'pm' ? 'PM' : entry.from.replace('member:', '@')
  const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })

  return (
    <li
      className={`flex flex-col gap-0.5 animate-bubble-pop-in ${isSent ? 'items-end' : 'items-start'}`}
    >
      <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted)] px-1">
        <span className="font-medium">{fromLabel}</span>
        {entry.intent !== 'message' && (
          <span
            className="px-1.5 py-[1px] rounded-full border text-[9px]"
            style={{ borderColor: tagColor, color: tagColor }}
          >
            {entry.intent}
          </span>
        )}
        <span className="opacity-60">{time}</span>
      </div>
      <div
        className={`max-w-[85%] text-[12px] px-2.5 py-1.5 rounded-lg border break-words ${
          isSent
            ? 'bg-[var(--accent-soft)] border-[var(--accent)]/30 text-[var(--text)]'
            : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--text)]'
        }`}
      >
        {entry.content}
        {isSent && entry.status && (
          <span
            className="inline-block ml-1.5 text-[10px]"
            style={{ color: statusColor }}
          >
            {statusIcon}
          </span>
        )}
      </div>
    </li>
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
    <div className="flex-shrink-0 flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
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
