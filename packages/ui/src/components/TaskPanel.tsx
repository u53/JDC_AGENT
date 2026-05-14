import { useState } from 'react'
import { useSessionStore } from '../stores/session-store'

export function TaskPanel() {
  const tasks = useSessionStore((s) => s.tasks)
  const [expanded, setExpanded] = useState(false)

  const active = tasks.filter(t => t.status !== 'completed')
  const pending = active.filter(t => t.status === 'pending').length
  const inProgress = active.filter(t => t.status === 'in_progress').length

  if (active.length === 0) return null

  return (
    <div className="border-t border-[#333] mx-6">
      <div
        className="flex items-center justify-between px-0 py-1.5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.1em]">
          <span className="inline-block h-2 w-2 rounded-full bg-[#4AF626]" />
          <span className="text-[#EAEAEA]">TASKS</span>
          <span className="text-[#666]">
            {pending > 0 && `${pending} pending`}
            {pending > 0 && inProgress > 0 && ' · '}
            {inProgress > 0 && `${inProgress} in progress`}
          </span>
        </div>
        <span className="text-[10px] text-[#666]">{expanded ? '▼' : '▶'}</span>
      </div>
      {expanded && (
        <div className="pb-2">
          {active.map(task => (
            <div key={task.id} className="flex items-center gap-2 px-0 py-0.5 text-xs">
              <span className={task.status === 'in_progress' ? 'text-[#4AF626] animate-pulse' : 'text-[#666]'}>
                {task.status === 'in_progress' ? '●' : '○'}
              </span>
              <span className="text-[#666]">#{task.id}</span>
              <span className="text-[#EAEAEA] truncate">{task.subject}</span>
              <span className="text-[10px] text-[#666] ml-auto">[{task.status}]</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
