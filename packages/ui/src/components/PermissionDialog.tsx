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
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
      <div className="w-[480px] rounded-[12px] border border-[#EAEAEA] bg-white p-8 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
        <h3 className="text-xs text-[#787774] uppercase tracking-wide font-medium mb-4">工具执行确认</h3>
        <div className="rounded-[8px] border border-[#EAEAEA] bg-[#F9F9F8] p-4 mb-6">
          <p className="font-mono text-sm text-[#2F3437]">{request.toolName}</p>
          <pre className="mt-2 text-xs font-mono text-[#787774] max-h-32 overflow-y-auto whitespace-pre-wrap">
            {JSON.stringify(request.input, null, 2)}
          </pre>
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => respond(false)}
            className="rounded-[6px] border border-[#EAEAEA] px-4 py-2 text-sm text-[#787774] hover:text-[#2F3437] transition-colors"
          >
            拒绝
          </button>
          <button
            onClick={() => respond(true)}
            className="rounded-[6px] bg-[#111111] px-4 py-2 text-sm text-white hover:opacity-90 transition-opacity"
          >
            允许
          </button>
        </div>
      </div>
    </div>
  )
}
