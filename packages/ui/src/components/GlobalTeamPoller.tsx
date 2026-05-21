import { useEffect, useRef } from 'react'
import { useSessionStore } from '../stores/session-store'
import { useBackgroundTaskStore } from '../stores/background-task-store'
import { useTeamStore, type TeamConversationEntry } from '../stores/team-store'

const formatEvent = (e: any): string => {
  const ts = new Date(e.timestamp).toISOString().slice(11, 19)
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

  useEffect(() => {
    if (!activeSessionId) return
    const teamIds = backgroundTasks
      .filter(t => t.type === 'team' && t.status === 'running')
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
          if (status) setTeamStatus(taskId, status)
          if (events) {
            setTeamEvents(taskId, events.map(formatEvent))
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
              } else if (e.type === 'member_progress' && e.text) {
                const text: string = e.text
                if (text.startsWith('[FINDING]') || text.startsWith('[QUESTION]') || text.startsWith('[BLOCKER]')) {
                  const dedupKey = `m:${e.memberId}:${e.timestamp}:${text.slice(0, 60)}`
                  appendConversationIfNew(taskId, {
                    id: dedupKey,
                    direction: 'received',
                    from: `member:${e.memberId}`,
                    intent: text.startsWith('[QUESTION]') ? 'question' : 'finding',
                    content: text,
                    timestamp: e.timestamp,
                    status: 'delivered',
                  }, dedupKey)
                }
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
