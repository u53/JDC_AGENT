import { useEffect, useState } from 'react'

interface PermissionRequest {
  id: string
  sessionId: string
  toolName: string
  input: Record<string, unknown>
}

interface Props {
  sessionId: string | null
}

export function PermissionDialog({ sessionId }: Props) {
  const [request, setRequest] = useState<PermissionRequest | null>(null)

  useEffect(() => {
    if (!window.electronAPI) return
    return window.electronAPI.on('permission:request', (_e: unknown, data: unknown) => {
      const req = data as PermissionRequest
      setRequest(req)
    })
  }, [])

  if (!request || request.sessionId !== sessionId) return null

  const respond = (allowed: boolean) => {
    window.electronAPI!.send('permission:response', { id: request.id, allowed })
    setRequest(null)
  }

  const isBash = request.toolName === 'bash'
  const bashCommand = isBash ? (request.input.command as string || '') : ''

  return (
    <div className="mb-3 border border-yellow-600/50 bg-yellow-900/10">
      <div className="flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-[0.1em]">
        <span className="inline-block h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
        <span className="text-yellow-400">PERMISSION REQUEST</span>
        <span className="text-[#EAEAEA]">{request.toolName}</span>
      </div>
      <div className="border-t border-[#333] px-3 py-2">
        {isBash ? (
          <pre className="text-xs text-[#4AF626] font-mono whitespace-pre-wrap break-all mb-3 max-h-[120px] overflow-y-auto">
            $ {bashCommand}
          </pre>
        ) : (
          <pre className="text-xs text-[#999] font-mono whitespace-pre-wrap break-all mb-3 max-h-[120px] overflow-y-auto">
            {JSON.stringify(request.input, null, 2)}
          </pre>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={() => respond(true)}
            className="text-[10px] uppercase tracking-[0.05em] text-[#4AF626] hover:text-[#6FFF4A] transition-colors"
          >
            [ALLOW]
          </button>
          <button
            onClick={() => respond(false)}
            className="text-[10px] uppercase tracking-[0.05em] text-[#E61919] hover:text-red-400 transition-colors"
          >
            [DENY]
          </button>
        </div>
      </div>
    </div>
  )
}
