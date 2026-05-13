import { useEffect, useState } from 'react'

interface PermissionRequest {
  id: string
  sessionId: string
  toolName: string
  input: Record<string, unknown>
}

export function PermissionDialog() {
  const [request, setRequest] = useState<PermissionRequest | null>(null)

  useEffect(() => {
    if (!window.electronAPI) return
    return window.electronAPI.on('permission:request', (_e: unknown, data: unknown) => {
      setRequest(data as PermissionRequest)
    })
  }, [])

  if (!request) return null

  const respond = (allowed: boolean) => {
    window.electronAPI.send('permission:response', { id: request.id, allowed })
    setRequest(null)
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="w-[480px] border border-[#333] bg-[#0A0A0A] p-6">
        <h3 className="text-sm uppercase tracking-[0.1em] font-bold text-[#EAEAEA] mb-4">
          [ PERMISSION REQUEST ]
        </h3>
        <div className="border border-[#333] p-4 mb-6">
          <p className="text-sm text-[#EAEAEA]">{request.toolName}</p>
          <pre className="mt-2 text-xs text-[#666] max-h-32 overflow-y-auto whitespace-pre-wrap">
            {JSON.stringify(request.input, null, 2)}
          </pre>
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => respond(false)}
            className="border border-[#E61919] text-[#E61919] px-4 py-2 text-xs uppercase tracking-[0.05em] hover:bg-[#E61919] hover:text-[#EAEAEA] transition-colors"
          >
            拒绝
          </button>
          <button
            onClick={() => respond(true)}
            className="border border-[#EAEAEA] text-[#EAEAEA] px-4 py-2 text-xs uppercase tracking-[0.05em] hover:bg-[#EAEAEA] hover:text-[#0A0A0A] transition-colors"
          >
            允许
          </button>
        </div>
      </div>
    </div>
  )
}
