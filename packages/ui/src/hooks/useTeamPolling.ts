import { useEffect, useRef } from 'react'
import { useTeamStore } from '../stores/team-store'

const formatEvent = (e: any): string => {
  const ts = new Date(e.timestamp).toISOString().slice(11, 19)
  switch (e.type) {
    case 'team_started': return `[${ts}] team_started ${e.teamId}`
    case 'manager_decision': return `[${ts}] PM: ${e.text}`
    case 'member_created': return `[${ts}] member_created ${e.memberId} (${e.role})`
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

export function useTeamPolling(sessionId: string | null, taskId: string | null, intervalMs = 1000) {
  const setTeamStatus = useTeamStore(s => s.setTeamStatus)
  const setTeamEvents = useTeamStore(s => s.setTeamEvents)
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
        if (events) setTeamEvents(taskId, events.map(formatEvent))
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
  }, [sessionId, taskId, intervalMs, setTeamStatus, setTeamEvents])
}
