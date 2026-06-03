import { useEffect, useState } from 'react'
import { AskUserCard } from './AskUserCard'

interface AskUserRequest {
  id: string
  sessionId: string
  question: string
  options?: { label: string; description?: string }[]
  multiSelect?: boolean
}

export function AskUserDialog() {
  const [request, setRequest] = useState<AskUserRequest | null>(null)

  useEffect(() => {
    if (!window.electronAPI) return
    return window.electronAPI.on('ask_user:request', (_e: unknown, data: unknown) => {
      setRequest(data as AskUserRequest)
    })
  }, [])

  if (!request) return null

  const handleRespond = (_id: string, answer: string) => {
    window.electronAPI?.send('ask_user:response', { id: request.id, answer })
    setRequest(null)
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="w-[520px] rounded-[14px]" style={{ boxShadow: 'var(--shadow-soft)' }}>
        <AskUserCard
          id={request.id}
          question={request.question}
          options={request.options}
          multiSelect={request.multiSelect}
          onRespond={handleRespond}
        />
      </div>
    </div>
  )
}
