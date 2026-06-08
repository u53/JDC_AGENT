import type { ContextInspectPayload } from '@jdcagnet/core'
import type { ContextHarvestQueue, ContextMemoryReview, ContextProviderHealth, ContextRefreshState, ContextRequestState } from '../../stores/context-store'
import { DiagnosticsList, formatDate, Metric, PanelFrame, PanelState } from './ContextPanelPrimitives'
import { HarvestQueuePanel } from './HarvestQueuePanel'
import { MemoryReviewPanel } from './MemoryReviewPanel'
import { ProviderHealthPanel } from './ProviderHealthPanel'

export function ContextAdvancedDiagnosticsPanel({ inspect, harvest, memoryReview, providerHealth, refresh, onReloadDiagnostics, onReindexCode, onReadProviderStatus }: {
  inspect: ContextRequestState<ContextInspectPayload>
  harvest: ContextRequestState<ContextHarvestQueue>
  memoryReview: ContextRequestState<ContextMemoryReview>
  providerHealth: ContextRequestState<ContextProviderHealth>
  refresh: ContextRequestState<ContextRefreshState>
  onReloadDiagnostics: () => void
  onReindexCode: () => void
  onReadProviderStatus: () => void
}) {
  const payload = inspect.data
  const advanced = payload?.advancedDiagnostics
  const diagnostics = uniqueDiagnostics([
    ...(payload?.diagnostics ?? []),
    ...(payload?.bundle?.diagnostics ?? []),
    ...(advanced?.diagnostics ?? []),
    ...(refresh.data?.diagnostics ?? []),
  ])

  return (
    <PanelFrame
      title="高级诊断"
      subtitle={payload ? `最近读取 ${formatDate(payload.inspectedAt)}` : '诊断缓存'}
      actions={(
        <div className="grid w-full min-w-0 gap-1.5">
          <ActionButton onClick={onReloadDiagnostics} disabled={inspect.loading}>
            {inspect.loading ? '正在读取诊断' : '重新读取诊断'}
          </ActionButton>
          <ActionButton onClick={onReindexCode} disabled={refresh.loading}>
            {refresh.loading ? '正在提交重建' : '后台重建代码索引'}
          </ActionButton>
          <ActionButton onClick={onReadProviderStatus} disabled={providerHealth.loading}>
            {providerHealth.loading ? '正在读取状态' : '读取提供方状态'}
          </ActionButton>
        </div>
      )}
    >
      <div className="space-y-3">
        {advanced?.noop && <NoopSummary noop={advanced.noop} />}

        {payload?.schemaInfo && (
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-[11px]">
            <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">存储</div>
            <div className="mt-1 break-all font-mono text-[var(--text)]">{payload.schemaInfo.dbPath}</div>
            <div className="mt-1 whitespace-normal break-words text-[10px] text-[var(--muted)] [overflow-wrap:anywhere]">
              结构版本 {payload.schemaInfo.version}{payload.schemaInfo.backupPath ? ` · 备份 ${payload.schemaInfo.backupPath}` : ''}
            </div>
          </div>
        )}

        {payload?.repoWiki && (
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-[11px]">
            <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">仓库 Wiki</div>
            <div className="mt-2 grid gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(90px,1fr))]">
              <Metric label="可用条目" value={payload.repoWiki.activeEntries} />
              <Metric label="过期条目" value={payload.repoWiki.staleEntries} />
              <Metric label="模型" value={payload.repoWiki.lastModelId ?? '未报告'} />
              <Metric label="生成时间" value={payload.repoWiki.lastGeneratedAt ? formatDate(payload.repoWiki.lastGeneratedAt) : '未报告'} />
            </div>
            {payload.repoWiki.lastDiagnostic && (
              <div className="mt-2 whitespace-normal break-words text-[10px] text-[var(--muted)] [overflow-wrap:anywhere]">{payload.repoWiki.lastDiagnostic}</div>
            )}
          </div>
        )}

        {refresh.error && <PanelState title="后台重建失败" message={refresh.error} />}
        {refresh.data && (
          <div className="grid grid-cols-2 gap-2">
            <Metric label="刷新状态" value={refresh.data.status} />
            <Metric label="提供方" value={refresh.data.requestedProviders.join(', ') || '未报告'} />
          </div>
        )}

        <HarvestQueuePanel queue={harvest.data} loading={harvest.loading} error={harvest.error} />
        <ProviderHealthPanel providers={providerHealth.data} timings={payload?.providerTimings} loading={providerHealth.loading} error={providerHealth.error} />
        <MemoryReviewPanel review={memoryReview.data} loading={memoryReview.loading} error={memoryReview.error} />
        <DiagnosticsList diagnostics={diagnostics} />
      </div>
    </PanelFrame>
  )
}

function ActionButton({ children, disabled, onClick }: {
  children: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full min-w-0 whitespace-normal break-words rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-left text-[11px] text-[var(--text)] transition-colors [overflow-wrap:anywhere] hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  )
}

function NoopSummary({ noop }: { noop: { rejected: number; diagnostics: number; harvestJobs: number } }) {
  const total = noop.rejected + noop.diagnostics + noop.harvestJobs
  if (total === 0) return null
  return (
    <div className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2">
      <div className="whitespace-normal break-words text-[11px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">已折叠空结果记录</div>
      <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(80px,1fr))]">
        <Metric label="候选" value={noop.rejected} />
        <Metric label="诊断" value={noop.diagnostics} />
        <Metric label="采集" value={noop.harvestJobs} />
      </div>
    </div>
  )
}

function uniqueDiagnostics(diagnostics: ContextInspectPayload['diagnostics']): ContextInspectPayload['diagnostics'] {
  const seen = new Set<string>()
  return diagnostics.filter((diagnostic) => {
    if (seen.has(diagnostic.id)) return false
    seen.add(diagnostic.id)
    return true
  })
}
