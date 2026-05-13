import { useEffect, useState } from 'react'

interface PermissionRequest {
  id: string
  sessionId: string
  toolName: string
  input: Record<string, unknown>
}

export function PermissionDialog() {
  const [request, setRequest] = useState<PermissionRequest | null>(null)
  const [alwaysAllow, setAlwaysAllow] = useState(false)

  useEffect(() => {
    if (!window.electronAPI) return
    return window.electronAPI.on('permission:request', (_e: unknown, data: unknown) => {
      setRequest(data as PermissionRequest)
      setAlwaysAllow(false)
    })
  }, [])

  if (!request) return null

  const respond = (allowed: boolean) => {
    window.electronAPI.send('permission:response', { id: request.id, allowed })
    setRequest(null)
  }

  const isBash = request.toolName === 'bash' || request.toolName === 'Bash'
  const bashCommand = isBash ? (request.input.command as string || '') : ''

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="w-[520px] border border-[#333] bg-[#0A0A0A] p-6">
        <h3 className="text-sm uppercase tracking-[0.1em] font-bold text-[#EAEAEA] mb-4">
          [ PERMISSION REQUEST ]
        </h3>

        <div className="mb-2">
          <span className="text-xs uppercase tracking-[0.05em] text-[#666]">Tool: </span>
          <span className="text-sm font-bold text-[#00FF41]">{request.toolName}</span>
        </div>

        <div className="border border-[#333] p-4 mb-4 max-h-[240px] overflow-y-auto">
          {isBash ? (
            <pre className="text-sm text-[#00FF41] font-mono whitespace-pre-wrap break-all">
              {bashCommand}
            </pre>
          ) : (
            <pre className="text-xs text-[#999] font-mono whitespace-pre-wrap break-all">
              {JSON.stringify(request.input, null, 2)}
            </pre>
          )}
        </div>

        <label className="flex items-center gap-2 mb-5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={alwaysAllow}
            onChange={(e) => setAlwaysAllow(e.target.checked)}
            className="w-3 h-3 accent-[#00FF41]"
          />
          <span className="text-xs text-[#666]">始终允许此工具</span>
        </label>

        <div className="flex justify-end gap-3">
          <button
            onClick={() => respond(false)}
            className="border border-[#E61919] text-[#E61919] px-4 py-2 text-xs uppercase tracking-[0.05em] hover:bg-[#E61919] hover:text-[#EAEAEA] transition-colors"
          >
            拒绝
          </button>
          <button
            onClick={() => respond(true)}
            className="border border-[#00FF41] text-[#00FF41] px-4 py-2 text-xs uppercase tracking-[0.05em] hover:bg-[#00FF41] hover:text-[#0A0A0A] transition-colors"
          >
            允许
          </button>
        </div>
      </div>
    </div>
  )
}
