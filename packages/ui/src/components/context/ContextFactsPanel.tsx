import type { ContextInspectPayload, MemorySearchPayload } from '@jdcagnet/core'
import { Badge, DiagnosticsList, formatDate, formatPercent, freshnessLabel, kindLabel, Metric, PanelFrame, PanelState, scopeLabel } from './ContextPanelPrimitives'

type ProjectFact = ContextInspectPayload['acceptedProjectFacts'][number]
type MemoryFact = MemorySearchPayload['results'][number]

type DisplayFact = {
  id: string
  kind: string
  scope: string
  content: string
  citations: ProjectFact['citations']
  confidence: number
  freshness: string
  sourceProvider: string
  updatedAt: number
  expiresAt?: number
  origin: string
}

export function ContextFactsPanel({ acceptedMemory, projectFacts, loading, error }: {
  acceptedMemory: MemorySearchPayload | null
  projectFacts: ProjectFact[]
  loading: boolean
  error: string | null
}) {
  const memoryFacts = (acceptedMemory?.results ?? []).map(displayMemoryFact)
  const memoryIds = new Set(memoryFacts.map((fact) => fact.id))
  const inspectFacts = projectFacts.filter((fact) => !memoryIds.has(fact.id)).map(displayProjectFact)
  const facts = [...memoryFacts, ...inspectFacts]

  if (loading && facts.length === 0) return <PanelState title="正在读取项目记忆" message="正在读取已接受的项目级记忆。" />
  if (error && facts.length === 0) return <PanelState title="项目记忆暂不可用" message={error} />

  return (
    <PanelFrame title="项目记忆" subtitle={`${facts.length} 条已接受事实`}>
      {acceptedMemory?.status === 'unavailable' && (
        <PanelState title="项目记忆暂不可用" message={acceptedMemory.diagnostics[0]?.message ?? '已接受记忆无法读取。'} />
      )}
      {error && facts.length > 0 && <PanelState title="部分项目记忆暂不可用" message={error} />}

      {facts.length === 0 ? (
        <PanelState title="暂无项目记忆" message="当前项目还没有已接受的持久记忆。" />
      ) : (
        <div className="space-y-2">
          {facts.map((fact) => (
            <article key={`${fact.origin}:${fact.id}`} className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="whitespace-normal break-words text-[12px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">{kindLabel(fact.kind)}</div>
                  <div className="mt-0.5 whitespace-normal break-words text-[10px] uppercase tracking-[0.08em] text-[var(--muted)] [overflow-wrap:anywhere]">
                    {scopeLabel(fact.scope)} · {fact.sourceProvider}
                  </div>
                </div>
                <Badge tone="good">已接受</Badge>
              </div>

              <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--text)] [overflow-wrap:anywhere]">{fact.content}</p>

              <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(110px,1fr))]">
                <Metric label="置信度" value={formatPercent(fact.confidence)} />
                <Metric label="新鲜度" value={freshnessLabel(fact.freshness)} />
                <Metric label="过期" value={fact.expiresAt ? formatDate(fact.expiresAt) : '无过期'} />
              </div>

              <CitationList citations={fact.citations} />
              <div className="whitespace-normal break-words text-[10px] text-[var(--muted)] [overflow-wrap:anywhere]">更新 {formatDate(fact.updatedAt)}</div>
            </article>
          ))}
        </div>
      )}

      {acceptedMemory && <DiagnosticsList diagnostics={acceptedMemory.diagnostics} />}
    </PanelFrame>
  )
}

function displayMemoryFact(fact: MemoryFact): DisplayFact {
  return { ...fact, origin: 'memory' }
}

function displayProjectFact(fact: ProjectFact): DisplayFact {
  return { ...fact, origin: 'inspect' }
}

function CitationList({ citations }: { citations: ProjectFact['citations'] }) {
  if (citations.length === 0) {
    return <div className="text-[10px] text-[var(--bad)]">引用 0</div>
  }

  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">引用</div>
      <div className="flex flex-wrap gap-1.5">
        {citations.map((citation) => (
          <span key={citation.id} className="max-w-full whitespace-normal break-words rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1 font-mono text-[10px] text-[var(--muted)] [overflow-wrap:anywhere]">
            {citation.ref}{citation.line ? `:${citation.line}` : ''}
          </span>
        ))}
      </div>
    </div>
  )
}
