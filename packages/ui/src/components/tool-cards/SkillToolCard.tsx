import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'

export function SkillToolCard({ event, input, result }: ToolCardRouterProps) {
  const status = event
    ? (event.type === 'complete' ? 'done' : event.type === 'error' ? 'error' : 'running')
    : (result?.is_error ? 'error' : 'done')

  const toolInput = event?.input || input || {}
  const skillName = (toolInput.skill || toolInput.name || '') as string
  const content = event?.result?.content || result?.content || ''

  return (
    <ToolCardShell
      label="SKILL"
      detail={skillName}
      status={status}
      defaultExpanded={false}
    >
      {content && (
        <pre className="max-h-48 overflow-auto p-2 text-[12px] whitespace-pre-wrap text-[var(--text)]" style={{ fontFamily: 'var(--font-mono)' }}>
          {content.slice(0, 200)}
          {content.length > 200 && '...'}
        </pre>
      )}
    </ToolCardShell>
  )
}
