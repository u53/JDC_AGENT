import type { ToolExecutionEvent } from '@jdcagnet/core'
import { GenericToolCard } from './GenericToolCard'
import { BashToolCard } from './BashToolCard'
import { EditToolCard } from './EditToolCard'
import { WriteToolCard } from './WriteToolCard'
import { ReadToolCard } from './ReadToolCard'
import { AgentToolCard } from './AgentToolCard'
import { SkillToolCard } from './SkillToolCard'
import { McpToolCard } from './McpToolCard'
import { parseMcpToolName } from './shared'

export interface ToolCardRouterProps {
  event?: ToolExecutionEvent
  name?: string
  input?: Record<string, unknown>
  result?: { content: string; is_error?: boolean }
}

const TOOL_CARD_REGISTRY: Record<string, React.ComponentType<ToolCardRouterProps>> = {
  Bash: BashToolCard,
  Edit: EditToolCard,
  Write: WriteToolCard,
  Read: ReadToolCard,
  Agent: AgentToolCard,
  Skill: SkillToolCard,
}

export function ToolCardRouter(props: ToolCardRouterProps) {
  const toolName = props.event?.toolName || props.name || ''

  const mcpParsed = parseMcpToolName(toolName)
  if (mcpParsed) {
    return <McpToolCard {...props} />
  }

  const Card = TOOL_CARD_REGISTRY[toolName]
  if (Card) {
    return <Card {...props} />
  }

  return <GenericToolCard {...props} />
}
