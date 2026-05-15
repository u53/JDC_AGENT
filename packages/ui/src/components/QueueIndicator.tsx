import { useSessionStore } from '../stores/session-store'

export function QueueIndicator() {
  const queue = useSessionStore((s) => s.messageQueue)
  const removeFromQueue = useSessionStore((s) => s.removeFromQueue)
  if (queue.length === 0) return null

  return (
    <div className="border-t border-[#333] mx-6 px-0 py-1.5 space-y-1">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.1em]">
        <span className="inline-block h-2 w-2 rounded-full bg-yellow-400" />
        <span className="text-yellow-400">QUEUED</span>
        <span className="text-[#666]">{queue.length} message{queue.length > 1 ? 's' : ''} waiting</span>
      </div>
      {queue.map((msg, i) => (
        <div key={i} className="flex items-center gap-2 pl-4">
          <span className="text-[11px] text-[#EAEAEA] truncate flex-1">{msg.length > 60 ? msg.slice(0, 60) + '...' : msg}</span>
          <button
            onClick={() => removeFromQueue(i)}
            className="text-[10px] text-[#666] hover:text-[#E61919] uppercase tracking-[0.1em] shrink-0"
          >
            [DEL]
          </button>
        </div>
      ))}
    </div>
  )
}
