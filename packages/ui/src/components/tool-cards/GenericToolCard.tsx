import type { ToolExecutionEvent } from '@jdcagnet/core'
import { ToolCardShell } from './ToolCardShell'

interface Props {
  event?: ToolExecutionEvent
  name?: string
  input?: Record<string, unknown>
  result?: { content: string; is_error?: boolean }
}

export function GenericToolCard({ event, name, input, result }: Props) {
  const toolName = event?.toolName || name || 'unknown'
  const status = event
    ? (event.type === 'complete' ? 'done' : event.type === 'error' ? 'error' : 'running')
    : (result?.is_error ? 'error' : 'done')
  const content = event?.result?.content || event?.message || result?.content
  const isError = event?.result?.isError || result?.is_error
  const toolInput = event?.input || input

  return (
    <ToolCardShell
      label="TOOL"
      detail={toolName}
      status={status}
      defaultExpanded={status === 'running'}
    >
      {toolInput && Object.keys(toolInput).length > 0 && (
        <pre className="max-h-48 overflow-auto p-2 text-[12px] whitespace-pre-wrap text-[var(--text)] mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
          {JSON.stringify(toolInput, null, 2)}
        </pre>
      )}
      {content && (
        <pre className={`max-h-48 overflow-auto p-2 text-[12px] whitespace-pre-wrap ${isError ? 'text-[var(--bad)]' : 'text-[var(--text)]'}`} style={{ fontFamily: 'var(--font-mono)' }}>
          {content}
        </pre>
      )}
    </ToolCardShell>
  )
}
