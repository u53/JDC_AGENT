import type { ContextInspectPayload } from '@jdcagnet/core'
import { Badge, formatDate, formatPercent, freshnessLabel, kindLabel, PanelFrame, PanelState } from './ContextPanelPrimitives'

type ProjectFact = ContextInspectPayload['acceptedProjectFacts'][number]

const TEAM_FACT_KINDS = new Set(['team_decision', 'task_result', 'artifact_summary', 'qa_issue'])

export function ContextTeamPanel({ payload, loading, error }: {
  payload: ContextInspectPayload | null
  loading: boolean
  error: string | null
}) {
  const facts = (payload?.acceptedProjectFacts ?? []).filter(isTeamFact)
  if (loading && facts.length === 0) return <PanelState title="正在读取团队沉淀" message="正在读取 Team/PM/Worker 产生的项目事实。" />
  if (error && facts.length === 0) return <PanelState title="团队沉淀暂不可用" message={error} />

  return (
    <PanelFrame title="团队沉淀" subtitle={`${facts.length} 条已接受团队事实`}>
      {facts.length === 0 ? (
        <PanelState title="暂无团队沉淀" message="Team/PM/Worker 还没有产出可复用的项目事实。" />
      ) : (
        <div className="space-y-2">
          {facts.map((fact) => (
            <article key={fact.id} className="rounded-[8px] border border-[var(--border)] bg-[var(--bg)] p-2">
              <div className="flex flex-wrap items-center gap-1">
                <Badge tone="accent">{kindLabel(fact.kind)}</Badge>
                <Badge>{freshnessLabel(fact.freshness)}</Badge>
                <Badge>{formatPercent(fact.confidence)}</Badge>
              </div>
              <div className="mt-2 text-[12px] leading-relaxed text-[var(--text)]">{fact.content}</div>
              <div className="mt-2 text-[10px] text-[var(--muted)]">更新于 {formatDate(fact.updatedAt)}</div>
            </article>
          ))}
        </div>
      )}
    </PanelFrame>
  )
}

function isTeamFact(fact: ProjectFact): boolean {
  return TEAM_FACT_KINDS.has(fact.kind)
}
