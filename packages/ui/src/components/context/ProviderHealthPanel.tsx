import type { ContextProviderHealth, ContextProviderHealthItem } from '../../stores/context-store'
import { Badge, formatDate, formatPercent, Metric, PanelFrame, PanelState, statusLabel, statusTone } from './ContextPanelPrimitives'

type ProviderTiming = {
  id: ContextProviderHealth[number]['id']
  startedAt: number
  completedAt: number
  durationMs: number
  status: string
}

export function ProviderHealthPanel({ providers, timings, loading, error }: {
  providers: ContextProviderHealth | null
  timings?: ProviderTiming[]
  loading: boolean
  error: string | null
}) {
  if (loading) return <PanelState title="正在读取提供方状态" message="正在读取提供方状态和耗时。" />
  if (error) return <PanelState title="提供方状态暂不可用" message={error} />
  if (!providers) return <PanelState title="尚未读取提供方状态" message="等待提供方状态缓存。" />

  const timingByProvider = new Map((timings ?? []).map((timing) => [timing.id, timing]))

  return (
    <PanelFrame title="提供方状态" subtitle={`${providers.length} 个提供方`}>
      <div className="whitespace-normal break-words rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-[11px] text-[var(--muted)] [overflow-wrap:anywhere]">
        状态来自缓存；代码索引重建以后台任务呈现。
      </div>
      {providers.length === 0 ? (
        <PanelState title="暂无提供方状态" message="当前上下文包没有提供方状态。" />
      ) : (
        <div className="space-y-2">
          {providers.map((provider) => {
            const timing = timingByProvider.get(provider.id)
            return (
              <article key={provider.id} className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="whitespace-normal break-words text-[12px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">{provider.id}</div>
                    <div className="mt-0.5 whitespace-normal break-words text-[10px] uppercase tracking-[0.08em] text-[var(--muted)] [overflow-wrap:anywhere]">更新 {formatDate(provider.updatedAt)}</div>
                  </div>
                  <Badge tone={statusTone(provider.status)}>{statusLabel(provider.status)}</Badge>
                </div>

                {timing && (
                  <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(95px,1fr))]">
                    <Metric label="耗时" value={`${timing.durationMs}ms`} />
                    <Metric label="耗时状态" value={statusLabel(timing.status)} />
                  </div>
                )}

                {provider.progress && <ProviderProgress provider={provider} />}
                {provider.backgroundJob && <BackgroundJob provider={provider} />}

                {provider.diagnostic && (
                  <div className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-[11px]">
                    <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">诊断</div>
                    <div className="mt-1 whitespace-normal break-words text-[var(--text)] [overflow-wrap:anywhere]">{provider.diagnostic.message}</div>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </PanelFrame>
  )
}

function ProviderProgress({ provider }: { provider: ContextProviderHealthItem }) {
  const progress = provider.progress
  if (!progress) return null
  const completed = progress.completed ?? progress.scanned
  const percent = progress.percent ?? (completed != null && progress.total ? completed / progress.total : null)
  return (
    <div className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">进度</div>
        {percent != null && <Badge tone="accent">{formatPercent(percent)}</Badge>}
      </div>
      <div className="mt-1 whitespace-normal break-words text-[var(--text)] [overflow-wrap:anywhere]">{progress.label ?? progress.message ?? '后台提供方进度'}</div>
      <div className="mt-1 whitespace-normal break-words text-[10px] text-[var(--muted)] [overflow-wrap:anywhere]">
        {completed != null && progress.total != null ? `${completed}/${progress.total}` : '数量未报告'}{progress.fromSnapshot ? ' · 来自快照' : ''}
      </div>
    </div>
  )
}

function BackgroundJob({ provider }: { provider: ContextProviderHealthItem }) {
  const job = provider.backgroundJob
  if (!job) return null
  return (
    <div className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">后台索引</div>
        {job.status && <Badge tone={statusTone(job.status)}>{statusLabel(job.status)}</Badge>}
      </div>
      <div className="mt-1 whitespace-normal break-words font-mono text-[var(--text)] [overflow-wrap:anywhere]">{job.id ?? '任务 ID 未报告'}</div>
      {job.message && <div className="mt-1 whitespace-normal break-words text-[var(--text)] [overflow-wrap:anywhere]">{job.message}</div>}
      <div className="mt-1 whitespace-normal break-words text-[10px] text-[var(--muted)] [overflow-wrap:anywhere]">
        {job.startedAt ? `开始 ${formatDate(job.startedAt)}` : job.queuedAt ? `排队 ${formatDate(job.queuedAt)}` : job.updatedAt ? `更新 ${formatDate(job.updatedAt)}` : '时间未报告'}
      </div>
    </div>
  )
}
