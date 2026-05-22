import { useEffect, useRef } from 'react'
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

export function useTeamPolling(sessionId: string | null, taskId: string | null, intervalMs = 1000) {
  const setTeamStatus = useTeamStore(s => s.setTeamStatus)
  const setTeamEvents = useTeamStore(s => s.setTeamEvents)
  const appendConversationIfNew = useTeamStore(s => s.appendConversationIfNew)
  const stopRef = useRef(false)

  useEffect(() => {
    if (!sessionId || !taskId) return
    stopRef.current = false
    const tick = async () => {
      if (stopRef.current) return
      try {
        const api = (window as any).electronAPI
        if (!api) return
        const [status, events] = await Promise.all([
          api.teamGetStatus(sessionId, taskId),
          api.teamGetEvents(sessionId, taskId, 200),
        ])
        if (status) setTeamStatus(taskId, status)
        if (events) {
          setTeamEvents(taskId, events.map(formatEvent))
          // Map PM-originated events to conversation entries
          for (const e of events) {
            // Only AI-generated replies should appear in conversation,
            // not mechanical state-machine logs like "Received... Actions:..."
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
              // Surface high-signal worker progress (skip frequent tool noise)
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
        if (status?.status === 'completed' || status?.status === 'failed' || status?.finished) {
          stopRef.current = true
          return
        }
      } catch (err) {
        // swallow polling errors
      }
    }
    tick()
    const handle = setInterval(tick, intervalMs)
    return () => {
      stopRef.current = true
      clearInterval(handle)
    }
  }, [sessionId, taskId, intervalMs, setTeamStatus, setTeamEvents, appendConversationIfNew])
}
