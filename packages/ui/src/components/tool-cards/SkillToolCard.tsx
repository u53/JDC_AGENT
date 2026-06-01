import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { ToolCopyButton } from './ToolCopyButton'
import { deriveToolStatus, getToolVariant, shouldShowToolRail } from './tool-card-meta'

export function SkillToolCard({ event, input, result, name }: ToolCardRouterProps) {
  const status = deriveToolStatus(event, result)
  const toolName = event?.toolName || name || 'Skill'

  const toolInput = event?.input || input || {}
  const skillName = (toolInput.skill || toolInput.name || '') as string
  const content = event?.result?.content || result?.content || ''

  return (
    <ToolCardShell
      label="SKILL"
      detail={skillName}
      status={status}
      defaultExpanded={false}
      rail={shouldShowToolRail(toolName, status)}
      variant={getToolVariant(toolName)}
      actions={content ? (
        <ToolCopyButton text={content} label="Skill" title="Copy skill content" iconOnly />
      ) : undefined}
    >
      {content && (
        <pre className="tool-result-pre text-[var(--text)]" style={{ fontFamily: 'var(--font-mono)' }}>
          {content}
        </pre>
      )}
    </ToolCardShell>
  )
}
