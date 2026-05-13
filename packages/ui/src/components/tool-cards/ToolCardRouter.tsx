import type { ToolExecutionEvent } from '@jdcagnet/core'
import { BashToolCard } from './BashToolCard'
import { GenericToolCard } from './GenericToolCard'
import { parseMcpToolName } from './shared'

export interface ToolCardRouterProps {
  event?: ToolExecutionEvent
  name?: string
  input?: Record<string, unknown>
  result?: { content: string; is_error?: boolean }
}

const TOOL_CARD_REGISTRY: Record<string, React.ComponentType<ToolCardRouterProps>> = {
  Bash: BashToolCard,
}

export function ToolCardRouter(props: ToolCardRouterProps) {
  const toolName = props.event?.toolName || props.name || ''

  const mcpParsed = parseMcpToolName(toolName)
  if (mcpParsed) {
    return <GenericToolCard {...props} />
  }

  const Card = TOOL_CARD_REGISTRY[toolName]
  if (Card) {
    return <Card {...props} />
  }

  return <GenericToolCard {...props} />
}
