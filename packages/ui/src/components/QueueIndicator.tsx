import { useSessionStore } from '../stores/session-store'

export function QueueIndicator() {
  const queue = useSessionStore((s) => s.messageQueue)
  if (queue.length === 0) return null

  return (
    <div className="border-t border-[#333] mx-6 px-0 py-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.1em]">
      <span className="inline-block h-2 w-2 rounded-full bg-yellow-400" />
      <span className="text-yellow-400">QUEUED</span>
      <span className="text-[#666]">{queue.length} message{queue.length > 1 ? 's' : ''} waiting</span>
    </div>
  )
}
