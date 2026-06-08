import { useState, useMemo, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTeamStore, type TeamConversationEntry } from '../stores/team-store'
import { useToastStore } from '../stores/toast-store'
import { MarkdownRenderer } from './MarkdownRenderer'

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
  const isComposingRef = useRef(false)
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
      <div className="flex flex-col h-full min-h-0 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface)_94%,transparent),color-mix(in_srgb,var(--bg)_86%,transparent))]">
        <Header title={`Team ${taskId.slice(0, 8)}`} onClose={onClose} />
        <div className="flex-1 flex items-center justify-center text-[12px] text-[var(--muted)]">
          Loading…
        </div>
      </div>
    )
  }

  const expandedMember = expandedMemberId
    ? (team.members ?? []).find((m: any) => m.id === expandedMemberId)
    : null
  const expandedMemberTask = expandedMember?.currentTaskId
    ? (team.tasks ?? []).find((t: any) => t.id === expandedMember.currentTaskId) ?? null
    : null

  return (
    <div className="flex flex-col h-full min-h-0 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface)_94%,transparent),color-mix(in_srgb,var(--bg)_86%,transparent))]">
      <Header
        title={team.objective}
        status={team.status}
        onClose={onClose}
      />

      <div className="context-panel-scroll flex-shrink-0 flex gap-1 overflow-x-auto border-b border-[var(--border)] px-3 py-2">
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
                <ManagerCard manager={team.manager} />
              ) : (
                <div className="text-[11px] text-[var(--muted)]">Initializing…</div>
              )}
            </Section>

            <Section title={`Members (${team.members?.length ?? 0})`}>
              <MemberBoard
                members={team.members ?? []}
                tasks={team.tasks ?? []}
                onSelect={(memberId) => setExpandedMember(memberId)}
              />
            </Section>

            <Section title={`Tasks (${team.taskStats?.completed ?? 0}/${team.taskStats?.total ?? 0})`}>
              <TaskBoard tasks={team.tasks ?? []} members={team.members ?? []} />
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
              <TeamEventTimeline events={events} limit={200} />
              <div ref={eventsEndRef} />
            </div>
          </div>
        )}
      </div>

      <div className="team-command-bar flex-shrink-0 space-y-2 border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_84%,transparent)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        {isFinished && (
          <div className="text-[10px] text-[var(--muted)] italic px-1">
            Team has {team.status}. Messages are disabled.
          </div>
        )}
        <div className="team-quick-actions flex flex-wrap gap-1.5">
          {QUICK_ACTIONS.map((a) => {
            const isActive = activeQuickAction === a.intent
            return (
              <button
                key={a.intent}
                disabled={isFinished}
                onClick={() => sendMessage(a.intent, a.message)}
                className={`text-[11px] px-2.5 py-1 rounded-[7px] border transition-all duration-150 active:translate-y-px ${
                  isActive
                    ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-soft)] scale-95'
                    : 'border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_36%,transparent)] text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[var(--border)] disabled:hover:text-[var(--text)]`}
              >
                {a.label}
              </button>
            )
          })}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 rounded-[8px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_38%,transparent)] p-1.5">
          <div
            className={`flex items-center gap-1 rounded-[7px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_30%,transparent)] px-2 py-1.5 font-mono text-[11px] text-[var(--muted)] ${
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
            onCompositionStart={() => {
              isComposingRef.current = true
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false
            }}
            onKeyDown={(e) => {
              if (isComposingRef.current || e.nativeEvent.isComposing) return
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            className="team-message-input min-w-0 flex-1 rounded-[7px] border border-transparent bg-transparent px-2.5 py-1.5 text-[12px] text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:bg-[color-mix(in_srgb,var(--surface)_62%,transparent)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || sending || isFinished}
            className={`text-[11px] px-3 py-1.5 rounded-[7px] transition-all duration-150 active:translate-y-px disabled:opacity-40 disabled:cursor-not-allowed ${
              justSent
                ? 'bg-[var(--good)] text-[var(--bg)]'
                : 'bg-[var(--accent)] text-[var(--bg)] hover:opacity-90'
            }`}
          >
            {sending ? 'Sending…' : justSent ? '✓ Sent' : 'Send'}
          </button>
        </div>
      </div>

      {expandedMember && (
        <TeamMemberModalPortal
          member={expandedMember}
          task={expandedMemberTask}
          events={events}
          onClose={() => setExpandedMember(null)}
        />
      )}
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
        <TeamMarkdown content={entry.content} />
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

function TeamMarkdown({ content, muted = false }: { content: string; muted?: boolean }) {
  return (
    <div
      className={`context-markdown min-w-0 text-[11px] leading-relaxed ${
        muted ? 'text-[var(--muted)]' : 'text-[var(--text)]'
      } [overflow-wrap:anywhere]`}
    >
      <MarkdownRenderer content={content} compact />
    </div>
  )
}

function TeamEventTimeline({
  events,
  limit,
  emptyMessage = '(no events yet)',
}: {
  events: string[]
  limit?: number
  emptyMessage?: string
}) {
  const visibleEvents = limit ? events.slice(-limit) : events
  if (visibleEvents.length === 0) {
    return (
      <div className="rounded-[8px] border border-dashed border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_36%,transparent)] px-3 py-3 text-[11px] italic text-[var(--muted)]">
        {emptyMessage}
      </div>
    )
  }

  return (
    <ol className="team-event-timeline space-y-1.5">
      {visibleEvents.map((line, index) => {
        const event = parseTeamEventLine(line)
        const tone = eventTone(event.kind, event.message)
        return (
          <li
            key={`${event.time}-${event.actor}-${event.kind}-${index}`}
            className="team-event-row grid min-w-0 grid-cols-[52px_1fr] gap-2 rounded-[8px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_36%,transparent)] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]"
          >
            <time className="font-mono text-[10px] leading-5 text-[var(--muted)] tabular-nums">
              {event.time}
            </time>
            <div className="min-w-0 space-y-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {event.actor && (
                  <span className="max-w-full break-words font-mono text-[10px] text-[var(--muted)] [overflow-wrap:anywhere]">
                    {event.actor}
                  </span>
                )}
                <span
                  className="max-w-full break-words rounded-[5px] border px-1.5 py-0.5 font-mono text-[10px] leading-none [overflow-wrap:anywhere]"
                  style={{
                    color: tone,
                    borderColor: `color-mix(in srgb, ${tone} 42%, var(--border))`,
                    backgroundColor: `color-mix(in srgb, ${tone} 9%, transparent)`,
                  }}
                >
                  {event.kind}
                </span>
              </div>
              {event.message && (
                <div className="min-w-0 whitespace-normal break-words text-[11px] leading-5 text-[var(--text)] [overflow-wrap:anywhere]">
                  {event.message}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function parseTeamEventLine(line: string): { time: string; actor: string | null; kind: string; message: string } {
  const timestampMatch = line.match(/^\[(\d{2}:\d{2}:\d{2})]\s*(.*)$/)
  const time = timestampMatch?.[1] ?? '--:--:--'
  let rest = timestampMatch?.[2] ?? line
  let actor: string | null = null

  const actorMatch = rest.match(/^\[([^\]]+)]\s*(.*)$/)
  if (actorMatch) {
    actor = actorMatch[1]
    rest = actorMatch[2]
  } else {
    const pmMatch = rest.match(/^PM(?:\s+\(([^)]+)\))?:\s*(.*)$/)
    if (pmMatch) {
      actor = 'PM'
      return {
        time,
        actor,
        kind: pmMatch[1] ? `PM ${pmMatch[1]}` : 'PM',
        message: pmMatch[2] ?? '',
      }
    }
  }

  const colonIndex = rest.indexOf(':')
  if (colonIndex > 0) {
    return {
      time,
      actor,
      kind: rest.slice(0, colonIndex).trim(),
      message: rest.slice(colonIndex + 1).trim(),
    }
  }

  const spaceIndex = rest.indexOf(' ')
  if (spaceIndex > 0) {
    return {
      time,
      actor,
      kind: rest.slice(0, spaceIndex).trim(),
      message: rest.slice(spaceIndex + 1).trim(),
    }
  }

  return { time, actor, kind: rest || 'event', message: '' }
}

function eventTone(kind: string, message: string): string {
  const text = `${kind} ${message}`.toLowerCase()
  if (text.includes('error') || text.includes('failed') || text.includes('cancelled')) return 'var(--bad)'
  if (text.includes('complete') || text.includes('completed')) return 'var(--good)'
  if (text.includes('pm') || text.includes('decision') || text.includes('assigned')) return 'var(--accent)'
  if (text.includes('start') || text.includes('progress') || text.includes('synthesizing')) return 'var(--warn)'
  return 'var(--muted)'
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
    <div className="flex-shrink-0 flex items-center justify-between border-b border-[var(--border)] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="font-mono text-[10px] uppercase text-[var(--muted)] font-semibold">
          Team
        </span>
        <span className="text-[13px] text-[var(--text)] truncate">{title}</span>
        {status && <StatusBadge status={status} small />}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Close"
          className="text-[var(--muted)] hover:text-[var(--text)] text-[14px] leading-none px-1.5 py-0.5 rounded-[6px] hover:bg-[var(--surface-2)] transition-colors"
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
      className={`shrink-0 rounded-[7px] border px-2.5 py-1.5 font-mono text-[11px] transition-colors active:translate-y-px ${
        active
          ? 'border-[color-mix(in_srgb,var(--accent)_32%,var(--border))] bg-[var(--accent-soft)] text-[var(--accent)]'
          : 'border-transparent text-[var(--muted)] hover:border-[var(--border)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
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
    <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(70px,1fr))]">
      {stats.map((s) => (
        <div key={s.label} className="rounded-[7px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_38%,transparent)] px-2 py-2 text-center">
          <div
            className="font-mono text-[16px] font-semibold"
            style={{ color: s.color ?? 'var(--text)' }}
          >
            {s.value}
          </div>
          <div className="font-mono text-[10px] text-[var(--muted)] uppercase">
            {s.label}
          </div>
        </div>
      ))}
    </div>
  )
}

function ManagerCard({ manager }: { manager: any }) {
  return (
    <div className="team-manager-card min-w-0 rounded-[8px] border border-[color-mix(in_srgb,var(--accent)_18%,var(--border))] bg-[color-mix(in_srgb,var(--surface-2)_46%,transparent)] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="whitespace-normal break-words text-[13px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">
            {manager.name}
          </div>
          <div className="mt-0.5 font-mono text-[10px] uppercase text-[var(--muted)]">
            Project Manager
          </div>
        </div>
        <StatusBadge status={manager.status} />
      </div>
      {manager.currentDecision && (
        <div className="mt-2 rounded-[7px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_38%,transparent)] px-2.5 py-2">
          <TeamMarkdown content={manager.currentDecision} muted />
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase text-[var(--muted)] font-semibold mb-2">
        {title}
      </div>
      {children}
    </div>
  )
}

function MemberBoard({
  members,
  tasks,
  onSelect,
}: {
  members: any[]
  tasks: any[]
  onSelect: (memberId: string) => void
}) {
  const taskById = useMemo(() => {
    const map = new Map<string, any>()
    for (const task of tasks) map.set(task.id, task)
    return map
  }, [tasks])

  if (members.length === 0) {
    return (
      <div className="rounded-[8px] border border-dashed border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_36%,transparent)] px-3 py-3 text-[11px] italic text-[var(--muted)]">
        No members yet.
      </div>
    )
  }

  return (
    <ul className="team-member-board grid gap-2">
      {members.map((member: any) => (
        <MemberCard
          key={member.id}
          member={member}
          currentTask={member.currentTaskId ? taskById.get(member.currentTaskId) : null}
          onClick={() => onSelect(member.id)}
        />
      ))}
    </ul>
  )
}

function MemberCard({
  member,
  currentTask,
  onClick,
}: {
  member: any
  currentTask: any | null
  onClick: () => void
}) {
  return (
    <li
      className="team-member-card min-w-0 rounded-[8px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_36%,transparent)] px-3 py-2.5 cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_34%,var(--border))] hover:bg-[color-mix(in_srgb,var(--accent)_7%,var(--surface-2))]"
      onClick={onClick}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 w-3.5 flex-shrink-0 text-[12px]">{statusIcon(member.status)}</span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 whitespace-normal break-words text-[12px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">
              {member.role}
            </div>
            <StatusBadge status={member.status} small />
          </div>
          {member.responsibility && (
            <div className="min-w-0 whitespace-normal break-words text-[11px] leading-5 text-[var(--muted)] [overflow-wrap:anywhere]">
              {member.responsibility}
            </div>
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <TaskMetaPill label={currentTask?.title ?? member.currentTaskId ?? 'Idle'} tone={currentTask ? 'var(--accent)' : 'var(--muted)'} />
            <TaskMetaPill label={member.toolCount > 0 ? `${member.toolCount} tools` : '0 tools'} />
          </div>
        </div>
      </div>
    </li>
  )
}

function TaskBoard({ tasks, members }: { tasks: any[]; members: any[] }) {
  const memberById = useMemo(() => {
    const map = new Map<string, any>()
    for (const member of members) map.set(member.id, member)
    return map
  }, [members])

  if (tasks.length === 0) {
    return (
      <div className="rounded-[8px] border border-dashed border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_36%,transparent)] px-3 py-3 text-[11px] italic text-[var(--muted)]">
        No tasks yet.
      </div>
    )
  }

  return (
    <ul className="team-task-board grid gap-2">
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          assignee={task.assigneeId ? memberById.get(task.assigneeId) : null}
        />
      ))}
    </ul>
  )
}

function TaskCard({ task, assignee }: { task: any; assignee: any | null }) {
  const preview = taskDescriptionPreview(task.description)
  return (
    <li className="team-task-card min-w-0 rounded-[8px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_36%,transparent)] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 w-3 flex-shrink-0 text-[11px]">{taskIcon(task.status)}</span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 whitespace-normal break-words text-[12px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">
              {task.title}
            </div>
            <StatusBadge status={task.status} small />
          </div>
          {preview && (
            <div className="min-w-0 whitespace-normal break-words text-[11px] leading-5 text-[var(--muted)] [overflow-wrap:anywhere]">
              {preview}
            </div>
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <TaskMetaPill label={assignee?.role ?? task.assigneeId ?? 'Unassigned'} />
            <TaskMetaPill label={task.priority ?? 'normal'} tone={priorityTone(task.priority)} />
          </div>
        </div>
      </div>
    </li>
  )
}

function TaskMetaPill({ label, tone = 'var(--muted)' }: { label: string; tone?: string }) {
  return (
    <span
      className="max-w-full break-words rounded-[5px] border px-1.5 py-0.5 font-mono text-[10px] leading-none [overflow-wrap:anywhere]"
      style={{
        color: tone,
        borderColor: `color-mix(in srgb, ${tone} 38%, var(--border))`,
        backgroundColor: `color-mix(in srgb, ${tone} 7%, transparent)`,
      }}
    >
      {label}
    </span>
  )
}

function priorityTone(priority?: string): string {
  const normalized = (priority ?? 'normal').toLowerCase()
  if (normalized === 'urgent' || normalized === 'high') return 'var(--warn)'
  if (normalized === 'low') return 'var(--muted)'
  return 'var(--accent)'
}

function taskDescriptionPreview(description?: string): string {
  if (!description) return ''
  const withoutCode = description.replace(/```[\s\S]*?```/g, '')
  const firstLine = withoutCode
    .split('\n')
    .map((line) => line.trim().replace(/^#{1,6}\s+/, '').replace(/^[-*]\s+/, ''))
    .find(Boolean)
  return (firstLine ?? '').slice(0, 140)
}

type MemberDetailModalProps = {
  member: any
  task: { id: string; title: string; description: string; status: string } | null
  events: string[]
  onClose: () => void
}

function TeamMemberModalPortal(props: MemberDetailModalProps) {
  const modal = <MemberDetailModal {...props} />
  if (typeof document === 'undefined' || !document.body) return modal
  return createPortal(modal, document.body)
}

function MemberDetailModal({
  member,
  task,
  events,
  onClose,
}: MemberDetailModalProps) {
  const memberEvents = useMemo(() => {
    const tag = `[${member.id}]`
    return events.filter((line) => line.includes(tag)).slice(-30)
  }, [events, member.id])

  // Close on Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="team-member-modal fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-3 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="team-member-modal-shell w-[min(660px,94vw)] max-h-[85vh] flex flex-col overflow-hidden rounded-[10px] border border-[color-mix(in_srgb,var(--accent)_16%,var(--border))] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface)_96%,transparent),color-mix(in_srgb,var(--bg)_92%,transparent))] shadow-2xl shadow-black/45"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_42%,transparent)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[14px]">{statusIcon(member.status)}</span>
              <span className="min-w-0 whitespace-normal break-words text-[14px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">{member.role}</span>
              <StatusBadge status={member.status} small />
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted)] font-mono">{member.id}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-[7px] border border-[var(--border)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] active:translate-y-px"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="context-panel-scroll overflow-y-auto px-4 py-3 space-y-3">
          {member.responsibility ? (
            <ModalSection title="Responsibility">
              <TeamMarkdown content={member.responsibility} />
            </ModalSection>
          ) : (
            <ModalSection title="Responsibility">
              <div className="text-[11px] text-[var(--muted)] italic">
                (no responsibility specified — this worker is generic)
              </div>
            </ModalSection>
          )}

          {member.expertPrompt && (
            <ModalSection title="Expert Prompt">
              <pre className="text-[11px] leading-snug text-[var(--text)] whitespace-pre-wrap font-mono max-h-[160px] overflow-y-auto bg-[var(--bg)] rounded p-2 border border-[var(--border)]">
                {member.expertPrompt}
              </pre>
            </ModalSection>
          )}

          <ModalSection title="Current task">
            {task ? (
              <div>
                <div className="text-[12px] text-[var(--text)]">
                  <span className="font-mono text-[var(--muted)]">{task.id}</span>{' '}
                  <span>{task.title}</span>
                </div>
                <div className="mt-1">
                  <TeamMarkdown
                    content={task.description.length > 400
                      ? task.description.slice(0, 400) + '…'
                      : task.description}
                    muted
                  />
                </div>
                <div className="mt-1.5">
                  <StatusBadge status={task.status} small />
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-[var(--muted)] italic">
                {member.currentTaskId
                  ? `(task ${member.currentTaskId} not found in current snapshot)`
                  : '(idle — not on any task)'}
              </div>
            )}
          </ModalSection>

          <ModalSection title={`Recent events (${memberEvents.length})`}>
            {memberEvents.length === 0 ? (
              <div className="text-[11px] text-[var(--muted)] italic">(no events for this member yet)</div>
            ) : (
              <TeamEventTimeline events={memberEvents} />
            )}
          </ModalSection>

          <ModalSection title="Metadata">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <MetaRow label="agentType" value={member.agentType} />
              <MetaRow label="modelId" value={member.modelId ?? '(default)'} />
              <MetaRow label="toolCount" value={String(member.toolCount ?? 0)} />
              <MetaRow
                label="lastActivity"
                value={new Date(member.lastActivityAt).toLocaleTimeString()}
              />
            </div>
          </ModalSection>
        </div>
      </div>
    </div>
  )
}

function ModalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-[8px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_34%,transparent)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
      <div className="mb-2 font-mono text-[10px] uppercase text-[var(--muted)]">
        {title}
      </div>
      {children}
    </section>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span className="text-[var(--muted)] flex-shrink-0">{label}:</span>
      <span className="text-[var(--text)] font-mono truncate">{value}</span>
    </div>
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
