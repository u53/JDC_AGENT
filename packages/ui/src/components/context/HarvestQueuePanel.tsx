import type { ContextHarvestQueue } from '../../stores/context-store'
import { Badge, formatDate, formatPercent, Metric, PanelFrame, PanelState, statusLabel, statusTone } from './ContextPanelPrimitives'

export function HarvestQueuePanel({ queue, loading, error }: {
  queue: ContextHarvestQueue | null
  loading: boolean
  error: string | null
}) {
  if (loading) return <PanelState title="正在读取采集记录" message="正在读取采集任务和状态。" />
  if (error) return <PanelState title="采集记录暂不可用" message={error} />
  if (!queue) return <PanelState title="尚未读取采集记录" message="等待诊断缓存。" />

  const visibleStatuses = ['accepted', 'skipped', 'rejected', 'failed'] as const

  return (
    <PanelFrame title="采集记录" subtitle={`${queue.jobs.length} 条记录`}>
      <div className="whitespace-normal break-words rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-[11px] text-[var(--muted)] [overflow-wrap:anywhere]">
        已接受表示采集器接受了提炼结果；持久复用以引用、置信度和过期校验为准。
      </div>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(70px,1fr))]">
        {visibleStatuses.map((status) => (
          <Metric key={status} label={statusLabel(status)} value={queue.summary[status]} />
        ))}
      </div>

      {queue.jobs.length === 0 ? (
        <PanelState title="暂无采集记录" message="当前会话没有保留的采集诊断。" />
      ) : (
        <div className="space-y-2">
          {queue.jobs.map((job) => (
            <article key={job.id} className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="whitespace-normal break-words text-[12px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">{job.id}</div>
                  <div className="mt-0.5 whitespace-normal break-words text-[10px] uppercase tracking-[0.08em] text-[var(--muted)] [overflow-wrap:anywhere]">轮次 {job.runLoopId}</div>
                </div>
                <Badge tone={statusTone(job.status)}>{statusLabel(job.status)}</Badge>
              </div>

              <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(95px,1fr))]">
                <Metric label="模型" value={job.modelBinding.modelId} />
                <Metric label="协议" value={job.modelBinding.providerProtocol} />
              </div>

              <div className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-[11px]">
                <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">原因</div>
                <div className="mt-1 whitespace-normal break-words text-[var(--text)] [overflow-wrap:anywhere]">{job.decision?.reason ?? '未记录'}</div>
              </div>

              <HarvestDurability job={job} />

              {job.candidate.userMessage && (
                <div className="line-clamp-2 whitespace-normal break-words text-[11px] text-[var(--muted)] [overflow-wrap:anywhere]">{job.candidate.userMessage}</div>
              )}

              <div className="whitespace-normal break-words text-[10px] text-[var(--muted)] [overflow-wrap:anywhere]">更新 {formatDate(job.updatedAt)}</div>
            </article>
          ))}
        </div>
      )}
    </PanelFrame>
  )
}

type HarvestJob = ContextHarvestQueue['jobs'][number]
type HarvestJobWithOptionalDurability = HarvestJob & {
  durableFactId?: string
  durableFactIds?: string[]
  factId?: string
  factIds?: string[]
  contextFactId?: string
  contextFactIds?: string[]
  acceptedFact?: HarvestAcceptedFact
  acceptedFacts?: HarvestAcceptedFact[]
  savedFacts?: HarvestAcceptedFact[]
  validation?: HarvestValidation
  validationResult?: HarvestValidation
  validationStatus?: string
  validationErrors?: string[]
  citations?: unknown[]
  confidence?: number
  expiresAt?: number
}

type HarvestAcceptedFact = {
  id?: string
  citations?: unknown[]
  confidence?: number
  expiresAt?: number
}

type HarvestValidation = {
  status?: string
  ok?: boolean
  accepted?: boolean
  errors?: string[]
  validationErrors?: string[]
  citations?: unknown[]
  confidence?: number
  expiresAt?: number
}

function HarvestDurability({ job }: { job: HarvestJob }) {
  const durability = harvestDurability(job)
  return (
    <div className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-[11px] space-y-2">
      <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(95px,1fr))]">
        <Metric label="持久事实" value={durability.factIds.length ? durability.factIds.join(', ') : '未报告'} />
        <Metric label="验证" value={durability.validation} />
      </div>
      <Metric label="引用/置信度/过期" value={durability.citationConfidenceExpiry} />
    </div>
  )
}

function harvestDurability(job: HarvestJob) {
  const extended = job as HarvestJobWithOptionalDurability
  const acceptedFacts = [extended.acceptedFact, ...(extended.acceptedFacts ?? []), ...(extended.savedFacts ?? [])].filter((fact): fact is HarvestAcceptedFact => Boolean(fact))
  const factIds = [
    extended.durableFactId,
    ...(extended.durableFactIds ?? []),
    extended.factId,
    ...(extended.factIds ?? []),
    extended.contextFactId,
    ...(extended.contextFactIds ?? []),
    ...acceptedFacts.map((fact) => fact.id),
  ].filter((id): id is string => Boolean(id))
  const validation = extended.validation ?? extended.validationResult
  const validationErrors = extended.validationErrors ?? validation?.validationErrors ?? validation?.errors ?? []
  const validationStatus = extended.validationStatus ?? validation?.status ?? (validation?.ok === true || validation?.accepted === true ? 'accepted' : validationErrors.length ? 'failed' : 'not reported')
  const citationCount = firstNumber(extended.citations?.length, validation?.citations?.length, ...acceptedFacts.map((fact) => fact.citations?.length))
  const confidence = firstNumber(extended.confidence, validation?.confidence, ...acceptedFacts.map((fact) => fact.confidence))
  const expiresAt = firstNumber(extended.expiresAt, validation?.expiresAt, ...acceptedFacts.map((fact) => fact.expiresAt))
  const citationConfidenceExpiry = citationCount == null && confidence == null && expiresAt == null
    ? '未报告'
    : `${citationCount ?? '未报告'} 引用 · ${confidence == null ? '置信度未报告' : formatPercent(confidence)} · ${expiresAt == null ? '过期未报告' : `过期 ${formatDate(expiresAt)}`}`
  return {
    factIds,
    validation: validationErrors.length ? `${statusLabel(validationStatus)} · ${validationErrors.join(', ')}` : statusLabel(validationStatus),
    citationConfidenceExpiry,
  }
}

function firstNumber(...values: Array<number | undefined>): number | undefined {
  return values.find((value) => typeof value === 'number' && Number.isFinite(value))
}
