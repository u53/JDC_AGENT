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

  const isBash = request.toolName === 'Bash'
  const bashCommand = isBash ? (request.input.command as string || '') : ''

  return (
    <div className="mb-3 border border-[var(--border)] bg-[var(--surface-2)] border-l-4 border-l-[var(--warn)] rounded-[8px]">
      <div className="flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-[0.1em]">
        <span className="inline-block h-2 w-2 rounded-full bg-[var(--warn)] animate-pulse" />
        <span className="text-[var(--warn)]">PERMISSION REQUEST</span>
        <span className="text-[var(--text)]">{request.toolName}</span>
      </div>
      <div className="border-t border-[var(--border)] px-3 py-2">
        {isBash ? (
          <pre className="text-xs text-[var(--good)] whitespace-pre-wrap break-all mb-3 max-h-[120px] overflow-y-auto" style={{ fontFamily: 'var(--font-mono)' }}>
            $ {bashCommand}
          </pre>
        ) : (
          <pre className="text-xs text-[var(--muted)] whitespace-pre-wrap break-all mb-3 max-h-[120px] overflow-y-auto" style={{ fontFamily: 'var(--font-mono)' }}>
            {JSON.stringify(request.input, null, 2)}
          </pre>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={() => respond(true)}
            className="text-[12px] text-[var(--good)] hover:opacity-80 transition-colors"
          >
            Allow
          </button>
          <button
            onClick={() => respond(false)}
            className="text-[12px] text-[var(--bad)] hover:opacity-80 transition-colors"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  )
}
