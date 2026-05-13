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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-800 rounded-xl w-[450px] p-6">
        <h3 className="text-sm font-medium text-zinc-300 mb-3">工具执行确认</h3>
        <div className="bg-zinc-900 rounded p-3 mb-4">
          <p className="text-sm font-mono text-zinc-200">{request.toolName}</p>
          <pre className="mt-2 text-xs text-zinc-400 max-h-32 overflow-y-auto whitespace-pre-wrap">
            {JSON.stringify(request.input, null, 2)}
          </pre>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={() => respond(false)} className="px-4 py-2 text-sm rounded bg-zinc-700 hover:bg-zinc-600">
            拒绝
          </button>
          <button onClick={() => respond(true)} className="px-4 py-2 text-sm rounded bg-green-600 hover:bg-green-500 text-white">
            允许
          </button>
        </div>
      </div>
    </div>
  )
}
