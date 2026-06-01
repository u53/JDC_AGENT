import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { ToolCopyButton } from './ToolCopyButton'
import {
  deriveToolStatus,
  formatToolLabel,
  getToolVariant,
  shouldShowToolRail,
  stringValue,
} from './tool-card-meta'

function taskDetail(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'TodoWrite' && Array.isArray(input.todos)) return `${input.todos.length} todos`
  if (toolName === 'TaskCreate') return stringValue(input.subject) || 'create task'
  if (toolName === 'TaskUpdate') return `${stringValue(input.taskId) || 'task'} · ${stringValue(input.status) || 'update'}`
  if (toolName === 'TaskGet' || toolName === 'TaskStop' || toolName === 'TaskOutput') return stringValue(input.taskId) || 'task'
  if (toolName === 'SaveMemory') return `${stringValue(input.name)} · ${stringValue(input.type)}`
  if (toolName === 'AskUser') return stringValue(input.question) || 'waiting for user'
  if (toolName === 'Team') return stringValue(input.objective) || 'team objective'
  if (toolName === 'BackgroundStatus' || toolName === 'BackgroundEvents' || toolName === 'BackgroundSend') return stringValue(input.task_id) || 'background task'
  if (toolName.startsWith('team_')) return stringValue(input.title) || stringValue(input.type) || 'team coordination'
  return toolName
}

function renderStructuredInput(toolName: string, input: Record<string, unknown>) {
  if (toolName === 'TodoWrite' && Array.isArray(input.todos)) {
    return (
      <div className="tool-list">
        {input.todos.map((todo, index) => {
          const item = todo as { subject?: unknown; description?: unknown }
          const description = stringValue(item.description)
          return (
            <div key={index}>
              <span>{index + 1}</span>
              <strong>{stringValue(item.subject) || 'Untitled task'}</strong>
              {description && <p>{description}</p>}
            </div>
          )
        })}
      </div>
    )
  }

  if (toolName === 'Team' && (Array.isArray(input.members) || Array.isArray(input.tasks))) {
    const objective = stringValue(input.objective)
    return (
      <div className="tool-team-input">
        {objective && <p>{objective}</p>}
        {Array.isArray(input.members) && input.members.length > 0 && (
          <div className="tool-chip-row">
            {input.members.slice(0, 6).map((member, index) => {
              const item = member as { role?: unknown; agentType?: unknown }
              return <span key={index}>{stringValue(item.role) || stringValue(item.agentType) || `MEMBER ${index + 1}`}</span>
            })}
          </div>
        )}
        {Array.isArray(input.tasks) && input.tasks.length > 0 && (
          <div className="tool-list">
            {input.tasks.slice(0, 5).map((task, index) => {
              const item = task as { title?: unknown; description?: unknown }
              const description = stringValue(item.description)
              return (
                <div key={index}>
                  <span>{index + 1}</span>
                  <strong>{stringValue(item.title) || 'Untitled task'}</strong>
                  {description && <p>{description}</p>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const entries = Object.entries(input).filter(([, value]) => value !== undefined && value !== '')
  if (entries.length === 0) return null
  return (
    <div className="tool-kv-grid">
      {entries.slice(0, 8).map(([key, value]) => {
        const text = typeof value === 'string' ? value : JSON.stringify(value)
        const isLong = text.length > 60
        return (
          <div key={key} className="relative group">
            <span>{key}</span>
            <strong className={isLong ? 'truncate block max-w-[300px]' : ''}>
              {text}
            </strong>
            {isLong && (
              <div className="absolute left-0 bottom-full mb-1 z-50 hidden group-hover:block max-w-[400px] p-2 text-[12px] text-[var(--text)] bg-[var(--surface-3)] border border-[var(--border)] rounded-[6px] shadow-lg whitespace-pre-wrap break-words">
                {text}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function TaskToolCard({ event, input, result, name }: ToolCardRouterProps) {
  const status = deriveToolStatus(event, result)
  const toolName = event?.toolName || name || 'Task'
  const toolInput = (event?.input || input || {}) as Record<string, unknown>
  const content = event?.result?.content || result?.content || ''
  const isError = event?.result?.isError || result?.is_error

  return (
    <ToolCardShell
      label={formatToolLabel(toolName)}
      detail={taskDetail(toolName, toolInput)}
      status={status}
      defaultExpanded={status === 'running'}
      rail={shouldShowToolRail(toolName, status)}
      variant={getToolVariant(toolName)}
      actions={content ? (
        <ToolCopyButton text={content} label="Result" title="Copy result" iconOnly />
      ) : undefined}
    >
      {renderStructuredInput(toolName, toolInput)}
      {content ? (
        <pre className={`tool-result-pre ${isError ? 'text-[var(--bad)]' : 'text-[var(--text)]'}`} style={{ fontFamily: 'var(--font-mono)' }}>
          {content}
        </pre>
      ) : status === 'running' ? (
        <div className="tool-empty-state">Working...</div>
      ) : (
        <div className="tool-empty-state">No result content.</div>
      )}
    </ToolCardShell>
  )
}
