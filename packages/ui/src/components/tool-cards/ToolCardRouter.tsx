import type { ToolExecutionEvent, ToolResultMetadata } from '@jdcagnet/core'
import type { ComponentType } from 'react'
import { GenericToolCard } from './GenericToolCard'
import { BashToolCard } from './BashToolCard'
import { EditToolCard } from './EditToolCard'
import { WriteToolCard } from './WriteToolCard'
import { MultiEditToolCard } from './MultiEditToolCard'
import { NotebookEditToolCard } from './NotebookEditToolCard'
import { ReadToolCard } from './ReadToolCard'
import { AgentToolCard } from './AgentToolCard'
import { SkillToolCard } from './SkillToolCard'
import { McpToolCard } from './McpToolCard'
import { JdcToolCard } from './JdcToolCard'
import { SearchToolCard } from './SearchToolCard'
import { ExternalToolCard } from './ExternalToolCard'
import { TaskToolCard } from './TaskToolCard'
import { getToolCardKind } from './tool-card-meta'

export interface ToolCardRouterProps {
  event?: ToolExecutionEvent
  name?: string
  input?: Record<string, unknown>
  result?: { content: string; is_error?: boolean; metadata?: ToolResultMetadata }
}

const TOOL_CARD_REGISTRY: Record<string, ComponentType<ToolCardRouterProps>> = {
  agent: AgentToolCard,
  bash: BashToolCard,
  edit: EditToolCard,
  external: ExternalToolCard,
  generic: GenericToolCard,
  jdc: JdcToolCard,
  mcp: McpToolCard,
  'multi-edit': MultiEditToolCard,
  'notebook-edit': NotebookEditToolCard,
  read: ReadToolCard,
  search: SearchToolCard,
  skill: SkillToolCard,
  task: TaskToolCard,
  write: WriteToolCard,
}

export function ToolCardRouter(props: ToolCardRouterProps) {
  const toolName = props.event?.toolName || props.name || ''
  const Card = TOOL_CARD_REGISTRY[getToolCardKind(toolName)] || GenericToolCard
  return <Card {...props} />
}
