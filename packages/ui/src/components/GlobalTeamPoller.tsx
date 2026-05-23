import { useEffect, useRef } from 'react'
import { useSessionStore } from '../stores/session-store'
import { useBackgroundTaskStore } from '../stores/background-task-store'
import { useTeamStore } from '../stores/team-store'

const formatEvent = (e: any): string => {
  const d = new Date(e.timestamp)
  const ts = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  switch (e.type) {
    case 'team_started': return `[${ts}] team_started ${e.teamId}`
    case 'manager_decision': return `[${ts}] PM: ${e.text}`
    case 'manager_reply': return `[${ts}] PM (reply): ${e.text}`
    case 'member_created': return `[${ts}] member_created ${e.memberId} (${e.role})`
    case 'member_added': return `[${ts}] member_added ${e.memberId} (${e.role}, ${e.agentType})${e.reason ? ` — ${e.reason}` : ''}`
    case 'member_removed': return `[${ts}] member_removed ${e.memberId} (${e.role})${e.reason ? ` — ${e.reason}` : ''}`
    case 'task_created': return `[${ts}] task_created "${e.title}"`
    case 'task_assigned': return `[${ts}] task_assigned ${e.taskId} -> ${e.memberId}`
    case 'task_completed': return `[${ts}] task_completed ${e.taskId} by ${e.memberId}`
    case 'task_cancelled': return `[${ts}] task_cancelled ${e.taskId}: ${e.reason}`
    case 'member_progress': return `[${ts}] [${e.memberId}] ${e.text}`
    case 'tool_start': return `[${ts}] [${e.memberId}] tool_start: ${e.toolName}`
    case 'tool_complete': return `[${ts}] [${e.memberId}] tool_complete: ${e.toolName}`
    case 'tool_error': return `[${ts}] [${e.memberId}] tool_error: ${e.toolName}${e.reason ? ` — ${e.reason}` : ''}`
    case 'message_sent': return `[${ts}] msg: ${e.from} -> ${e.to} (${e.intent})`
    case 'intervention_received': return `[${ts}] intervention from ${e.from}: ${e.intent}`
    case 'team_synthesizing': return `[${ts}] team_synthesizing`
    case 'team_completed': return `[${ts}] team_completed`
    case 'team_failed': return `[${ts}] team_failed: ${e.error}`
    default: return `[${ts}] ${e.type}`
  }
}

/**
 * Mounted globally at App level — polls ALL active teams regardless of whether
 * the Team panel is open. Ensures PM messages are accumulated into the store
 * even when the user is on another panel/tab.
 */
export function GlobalTeamPoller() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const backgroundTasks = useBackgroundTaskStore((s) => s.tasks)
  const setTeamStatus = useTeamStore((s) => s.setTeamStatus)
  const setTeamEvents = useTeamStore((s) => s.setTeamEvents)
  const appendConversationIfNew = useTeamStore((s) => s.appendConversationIfNew)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  /**
   * Teams we've fetched a final snapshot for after they transitioned to a
   * terminal state. Once a team is here, the poller stops re-fetching it on
   * each tick (no point — its state is frozen). Cleared with the session.
   */
  const finalizedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!activeSessionId) return
    // Poll all running teams + any terminal teams we haven't yet snapshotted.
    // The "haven't snapshotted" pass is what fixes:
    //   - UI freezing on the pre-completion frame because the next poll cycle
    //     skipped the team the moment it flipped to completed
    //   - "Loading…" forever after a window reload, because the store had no
    //     entry for the completed team and the old poller never touched it
    const teamIds = backgroundTasks
      .filter(t => t.type === 'team')
      .filter(t => t.status === 'running' || !finalizedRef.current.has(t.id))
      .map(t => t.id)
    if (teamIds.length === 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    const poll = async () => {
      const api = (window as any).electronAPI
      if (!api) return
      for (const taskId of teamIds) {
        try {
          const [status, events] = await Promise.all([
            api.teamGetStatus(activeSessionId, taskId),
            api.teamGetEvents(activeSessionId, taskId, 200),
          ])
          if (status) {
            setTeamStatus(taskId, status)
            // If this team is now in a terminal state, this is the LAST poll
            // we need — mark so we don't keep hitting the IPC every tick.
            if (status.finished || status.status === 'completed' || status.status === 'failed' || status.status === 'stopped') {
              finalizedRef.current.add(taskId)
            }
          }
          if (!events) continue
          setTeamEvents(taskId, events.map(formatEvent))

          // Build lookup tables so we can render task ids as titles and member ids as roles
          const taskTitles = new Map<string, string>()
          for (const t of (status?.tasks ?? [])) taskTitles.set(t.id, t.title)
          const memberRoles = new Map<string, string>()
          for (const m of (status?.members ?? [])) memberRoles.set(m.id, m.role)
          // Cumulative role lookup from all task_created / member_added events too,
          // so removed members are still resolvable.
          for (const ev of events) {
            if (ev.type === 'task_created' && ev.taskId && ev.title) taskTitles.set(ev.taskId, ev.title)
            if ((ev.type === 'member_added' || ev.type === 'member_created') && ev.memberId && ev.role) {
              memberRoles.set(ev.memberId, ev.role)
            }
          }
          const taskLabel = (id: string) => {
            const t = taskTitles.get(id)
            return t ? `「${t}」` : id
          }
          const memberLabel = (id: string) => {
            const r = memberRoles.get(id)
            return r ? `${r}` : id
          }

          for (const e of events) {
            if (e.type === 'manager_reply' && e.text) {
              const dedupKey = `pm_reply:${e.timestamp}:${e.text.slice(0, 60)}`
              appendConversationIfNew(taskId, {
                id: dedupKey,
                direction: 'received',
                from: 'pm',
                intent: 'message',
                content: e.text,
                timestamp: e.timestamp,
                status: 'delivered',
              }, dedupKey)
            } else if (e.type === 'manager_decision' && e.text) {
              // Surface PM internal decisions (reopens, errors, etc.) as a soft note
              const dedupKey = `pm_decision:${e.timestamp}:${e.text.slice(0, 60)}`
              appendConversationIfNew(taskId, {
                id: dedupKey,
                direction: 'received',
                from: 'pm',
                intent: 'finding',
                content: `💭 ${e.text}`,
                timestamp: e.timestamp,
                status: 'delivered',
              }, dedupKey)
            } else if (e.type === 'task_created') {
              const dedupKey = `task_created:${e.timestamp}:${e.taskId}`
              appendConversationIfNew(taskId, {
                id: dedupKey,
                direction: 'received',
                from: 'pm',
                intent: 'message',
                content: `📝 拆出新任务 ${taskLabel(e.taskId)}`,
                timestamp: e.timestamp,
                status: 'delivered',
              }, dedupKey)
            } else if (e.type === 'task_assigned') {
              const dedupKey = `task_assigned:${e.timestamp}:${e.taskId}:${e.memberId}`
              appendConversationIfNew(taskId, {
                id: dedupKey,
                direction: 'received',
                from: 'pm',
                intent: 'message',
                content: `📋 把任务 ${taskLabel(e.taskId)} 交给了 ${memberLabel(e.memberId)}`,
                timestamp: e.timestamp,
                status: 'delivered',
              }, dedupKey)
            } else if (e.type === 'task_completed') {
              const dedupKey = `task_completed:${e.timestamp}:${e.taskId}`
              appendConversationIfNew(taskId, {
                id: dedupKey,
                direction: 'received',
                from: 'pm',
                intent: 'finding',
                content: `✅ 任务 ${taskLabel(e.taskId)} 已完成（${memberLabel(e.memberId)}）`,
                timestamp: e.timestamp,
                status: 'delivered',
              }, dedupKey)
            } else if (e.type === 'task_cancelled') {
              const dedupKey = `task_cancelled:${e.timestamp}:${e.taskId}`
              appendConversationIfNew(taskId, {
                id: dedupKey,
                direction: 'received',
                from: 'pm',
                intent: 'finding',
                content: `🛑 任务 ${taskLabel(e.taskId)} 被取消${e.reason ? `（${e.reason}）` : ''}`,
                timestamp: e.timestamp,
                status: 'delivered',
              }, dedupKey)
            } else if (e.type === 'member_added') {
              const dedupKey = `member_added:${e.timestamp}:${e.memberId}`
              const reasonText = e.reason ? `（${e.reason}）` : ''
              appendConversationIfNew(taskId, {
                id: dedupKey,
                direction: 'received',
                from: 'pm',
                intent: 'finding',
                content: `🧑‍💼 招了一位 ${e.role}${reasonText}`,
                timestamp: e.timestamp,
                status: 'delivered',
              }, dedupKey)
            } else if (e.type === 'member_removed') {
              const dedupKey = `member_removed:${e.timestamp}:${e.memberId}`
              const reasonText = e.reason ? `（${e.reason}）` : ''
              appendConversationIfNew(taskId, {
                id: dedupKey,
                direction: 'received',
                from: 'pm',
                intent: 'finding',
                content: `👋 让 ${e.role} 离开了团队${reasonText}`,
                timestamp: e.timestamp,
                status: 'delivered',
              }, dedupKey)
            } else if (e.type === 'team_synthesizing') {
              const dedupKey = `team_synth:${e.timestamp}`
              appendConversationIfNew(taskId, {
                id: dedupKey,
                direction: 'received',
                from: 'pm',
                intent: 'message',
                content: `🧩 正在汇总各成员的产物…`,
                timestamp: e.timestamp,
                status: 'delivered',
              }, dedupKey)
            } else if (e.type === 'team_completed') {
              const dedupKey = `team_completed:${e.timestamp}`
              appendConversationIfNew(taskId, {
                id: dedupKey,
                direction: 'received',
                from: 'pm',
                intent: 'finding',
                content: `🎉 团队任务完成。${e.summary ? `\n\n${e.summary.split('\n')[0]}` : ''}`,
                timestamp: e.timestamp,
                status: 'delivered',
              }, dedupKey)
            } else if (e.type === 'team_failed') {
              const dedupKey = `team_failed:${e.timestamp}`
              appendConversationIfNew(taskId, {
                id: dedupKey,
                direction: 'received',
                from: 'pm',
                intent: 'question',
                content: `❌ 团队失败: ${e.error}`,
                timestamp: e.timestamp,
                status: 'delivered',
              }, dedupKey)
            } else if (e.type === 'member_progress' && e.text) {
              const text: string = e.text
              if (text.startsWith('[FINDING]') || text.startsWith('[QUESTION]') || text.startsWith('[BLOCKER]') || text.startsWith('[ISSUE')) {
                const dedupKey = `m:${e.memberId}:${e.timestamp}:${text.slice(0, 60)}`
                appendConversationIfNew(taskId, {
                  id: dedupKey,
                  direction: 'received',
                  from: `member:${memberLabel(e.memberId)}`,
                  intent: text.startsWith('[QUESTION]') ? 'question' : 'finding',
                  content: text,
                  timestamp: e.timestamp,
                  status: 'delivered',
                }, dedupKey)
              }
            }
          }
        } catch {
          // swallow
        }
      }
    }

    poll()
    intervalRef.current = setInterval(poll, 1500)
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [activeSessionId, backgroundTasks, setTeamStatus, setTeamEvents, appendConversationIfNew])

  return null
}
