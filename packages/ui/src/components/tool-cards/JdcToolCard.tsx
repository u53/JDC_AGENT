import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import {
  IconJdcGraph, IconJdcSearch, IconJdcCallers, IconJdcCallees,
  IconJdcImpact, IconJdcTrace, IconFiles,
} from '../icons'
import { ToolCopyButton } from './ToolCopyButton'
import type { ComponentType } from 'react'
import { deriveToolStatus } from './tool-card-meta'

interface IconProps { size?: number; className?: string }

// Per-tool presentation: friendly label, icon, and how to summarize the input.
const TOOL_META: Record<string, {
  label: string
  Icon: ComponentType<IconProps>
  summary: (input: Record<string, unknown>) => string
}> = {
  JdcContext: {
    label: '上下文检索', Icon: IconJdcGraph,
    summary: (i) => str(i.task),
  },
  JdcSearch: {
    label: '符号搜索', Icon: IconJdcSearch,
    summary: (i) => str(i.query),
  },
  JdcNode: {
    label: '符号详情', Icon: IconJdcGraph,
    summary: (i) => str(i.symbol),
  },
  JdcCallers: {
    label: '谁调用了它', Icon: IconJdcCallers,
    summary: (i) => str(i.symbol),
  },
  JdcCallees: {
    label: '它调用了谁', Icon: IconJdcCallees,
    summary: (i) => str(i.symbol),
  },
  JdcImpact: {
    label: '影响半径', Icon: IconJdcImpact,
    summary: (i) => str(i.symbol),
  },
  JdcTrace: {
    label: '调用路径', Icon: IconJdcTrace,
    summary: (i) => `${str(i.from)} → ${str(i.to)}`,
  },
  JdcExplore: {
    label: '批量源码', Icon: IconFiles,
    summary: (i) => Array.isArray(i.symbols) ? (i.symbols as unknown[]).map(String).join(', ') : '',
  },
  JdcFiles: {
    label: '项目文件', Icon: IconFiles,
    summary: (i) => str(i.path) || '全部',
  },
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

// Count how many symbol rows ("- kind name — file:line") are in the result,
// to show a quick "N results" hint in the header.
function countResultRows(content: string): number {
  let n = 0
  for (const line of content.split('\n')) {
    if (/^\s*[-→]\s+\S/.test(line)) n++
  }
  return n
}

export function JdcToolCard({ event, input, result, name }: ToolCardRouterProps) {
  const status = deriveToolStatus(event, result)

  const toolName = event?.toolName || name || ''
  const meta = TOOL_META[toolName] ?? {
    label: toolName.replace(/^Jdc/, ''), Icon: IconJdcGraph, summary: () => '',
  }

  const toolInput = (event?.input || input || {}) as Record<string, unknown>
  const content = event?.result?.content || result?.content || ''
  const summary = meta.summary(toolInput)
  const rowCount = status === 'done' && content ? countResultRows(content) : 0
  const Icon = meta.Icon

  return (
    <ToolCardShell
      label="JDC ENGINE"
      detail={summary || meta.label}
      status={status}
      defaultExpanded={false}
      rail
      variant="jdc"
      className="jdc-engine-card"
      actions={
        content ? (
          <ToolCopyButton text={content} label="Result" title="复制结果" iconOnly />
        ) : undefined
      }
    >
      <div className="jdc-engine-head">
        <span className="jdc-engine-glyph"><Icon size={15} /></span>
        <span className="jdc-engine-op">{meta.label}</span>
        {rowCount > 0 && <span className="jdc-engine-count">{rowCount} 项结果</span>}
      </div>
      {content ? (
        <pre className="jdc-engine-result">{content}</pre>
      ) : status === 'running' ? (
        <div className="jdc-engine-empty">分析中…</div>
      ) : (
        <div className="jdc-engine-empty">无结果</div>
      )}
    </ToolCardShell>
  )
}
