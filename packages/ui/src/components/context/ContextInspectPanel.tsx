import type { ContextInspectPayload } from '@jdcagnet/core'
import { formatDate, formatTokens, Metric, PanelFrame, PanelState, statusLabel } from './ContextPanelPrimitives'

export function ContextInspectPanel({ payload, loading, error }: {
  payload: ContextInspectPayload | null
  loading: boolean
  error: string | null
}) {
  if (loading) return <PanelState title="正在读取当前状态" message="正在读取 JDC 上下文引擎状态。" />
  if (error) return <PanelState title="当前状态暂不可用" message={error} />
  if (!payload) return <PanelState title="尚未读取当前状态" message="等待会话上下文状态。" />
  if (payload.status === 'disabled') return <PanelState title="上下文引擎已关闭" message="聊天继续运行，当前不会注入项目上下文。" />
  if (payload.status === 'unavailable') return <PanelState title="上下文暂不可用" message={payload.diagnostics[0]?.message ?? '上下文状态无法读取。'} />

  const sectionCount = payload.bundle?.sections.length ?? 0
  const usedTokens = payload.bundle?.budget.usedTokens ?? 0
  const droppedTokens = payload.bundle?.budget.droppedTokens ?? 0
  const providerSummary = summarizeProviders(payload.providerHealth)

  return (
    <PanelFrame title="当前状态" subtitle={`最近读取 ${formatDate(payload.inspectedAt)}`}>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(120px,1fr))]">
        <Metric label="引擎状态" value={statusLabel(payload.status)} />
        <Metric label="注入段落" value={sectionCount} />
        <Metric label="项目记忆" value={payload.acceptedProjectFacts.length} />
        <Metric label="提供方" value={providerSummary} />
      </div>

      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(120px,1fr))]">
        <Metric label="已使用" value={formatTokens(usedTokens)} />
        <Metric label="已裁剪" value={formatTokens(droppedTokens)} />
      </div>
    </PanelFrame>
  )
}

function summarizeProviders(providers: ContextInspectPayload['providerHealth']): string {
  if (providers.length === 0) return '未报告'
  const available = providers.filter((provider) => provider.status === 'enabled' || provider.status === 'fresh' || provider.status === 'cached').length
  return `${available}/${providers.length}`
}
