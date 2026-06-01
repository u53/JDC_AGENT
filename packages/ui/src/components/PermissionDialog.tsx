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
    <div className="aux-card mb-3" data-tone="warn">
      <div className="aux-card-header">
        <div className="aux-card-title">
          <span className="aux-card-dot is-live" />
          <span className="aux-card-label">PERMISSION REQUEST</span>
          <span className="aux-card-muted">{request.toolName}</span>
        </div>
      </div>
      <div className="aux-card-body">
        {isBash ? (
          <pre className="text-xs text-[var(--good)] whitespace-pre-wrap break-all mb-3 max-h-[120px] overflow-y-auto" style={{ fontFamily: 'var(--font-mono)' }}>
            $ {bashCommand}
          </pre>
        ) : (
          <pre className="text-xs text-[var(--muted)] whitespace-pre-wrap break-all mb-3 max-h-[120px] overflow-y-auto" style={{ fontFamily: 'var(--font-mono)' }}>
            {JSON.stringify(request.input, null, 2)}
          </pre>
        )}
        <div className="aux-card-actions">
          <button
            onClick={() => respond(true)}
            className="aux-card-action is-good"
          >
            Allow
          </button>
          <button
            onClick={() => respond(false)}
            className="aux-card-action is-danger"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  )
}
