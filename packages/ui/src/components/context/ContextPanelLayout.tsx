import type { ContextInspectPayload } from '@jdcagnet/core'
import type { ContextHarvestQueue, ContextMemoryReview, ContextProviderHealth, ContextRefreshState, ContextRequestState } from '../../stores/context-store'
import { ContextAdvancedDiagnosticsPanel } from './ContextAdvancedDiagnosticsPanel'
import { ContextCurrentPanel } from './ContextCurrentPanel'
import { ContextFactsPanel } from './ContextFactsPanel'
import { ContextInspectPanel } from './ContextInspectPanel'
import { Badge, formatPercent, freshnessLabel, kindLabel, PanelFrame, PanelState } from './ContextPanelPrimitives'

export type ContextTab = 'understanding' | 'facts' | 'current' | 'team' | 'status' | 'advanced'

export function ContextPanelLayout({ sessionId, activeTab, onTabChange, inspect, harvest, memoryReview, providerHealth, refresh, onReloadDiagnostics, onReindexCode, onReadProviderStatus }: {
  sessionId: string | null
  activeTab: ContextTab
  onTabChange: (tab: ContextTab) => void
  inspect: ContextRequestState<ContextInspectPayload>
  harvest: ContextRequestState<ContextHarvestQueue>
  memoryReview: ContextRequestState<ContextMemoryReview>
  providerHealth: ContextRequestState<ContextProviderHealth>
  refresh: ContextRequestState<ContextRefreshState>
  onReloadDiagnostics: () => void
  onReindexCode: () => void
  onReadProviderStatus: () => void
}) {
  if (!sessionId) {
    return (
      <div className="p-3">
        <div className="text-[12px] text-[var(--muted)]">没有活动会话。</div>
      </div>
    )
  }

  const tabs = contextTabs(inspect.data, memoryReview.data, providerHealth.data)

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--panel)]">
      <div className="flex-shrink-0 border-b border-[var(--border)] px-3 py-2">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-[var(--text)]">JDC 上下文引擎</div>
          <div className="mt-0.5 text-[10px] text-[var(--muted)]">项目级上下文</div>
        </div>
      </div>

      <div className="context-panel-scroll flex min-w-0 flex-shrink-0 gap-1 overflow-x-auto border-b border-[var(--border)] px-3">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onTabChange(item.id)}
            className={`min-w-0 shrink-0 whitespace-nowrap border-b-2 px-2 py-2 text-[11px] transition-colors ${activeTab === item.id ? 'border-[var(--accent)] text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}
          >
            {item.label}
            {item.badge != null && <span className="ml-1 opacity-60">{item.badge}</span>}
          </button>
        ))}
      </div>

      <div className="context-panel-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {activeTab === 'understanding' && <ContextProjectUnderstandingPanel payload={inspect.data} loading={inspect.loading} error={inspect.error} />}
        {activeTab === 'facts' && <ContextFactsPanel acceptedMemory={memoryReview.data?.accepted ?? null} projectFacts={inspect.data?.acceptedProjectFacts ?? []} loading={memoryReview.loading || inspect.loading} error={memoryReview.error ?? inspect.error} />}
        {activeTab === 'current' && <ContextCurrentPanel payload={inspect.data} loading={inspect.loading} error={inspect.error} />}
        {activeTab === 'team' && <ContextTeamPlaceholder loading={inspect.loading} error={inspect.error} />}
        {activeTab === 'status' && <ContextInspectPanel payload={inspect.data} loading={inspect.loading} error={inspect.error} />}
        {activeTab === 'advanced' && (
          <ContextAdvancedDiagnosticsPanel
            inspect={inspect}
            harvest={harvest}
            memoryReview={memoryReview}
            providerHealth={providerHealth}
            refresh={refresh}
            onReloadDiagnostics={onReloadDiagnostics}
            onReindexCode={onReindexCode}
            onReadProviderStatus={onReadProviderStatus}
          />
        )}
      </div>
    </div>
  )
}

function contextTabs(inspect: ContextInspectPayload | null, memoryReview: ContextMemoryReview | null, providerHealth: ContextProviderHealth | null) {
  const factCount = (memoryReview?.accepted?.results.length ?? 0) + (inspect?.acceptedProjectFacts.length ?? 0)
  const teamCount = (inspect?.acceptedProjectFacts ?? []).filter((fact) => isTeamFactKind(fact.kind)).length
  return [
    { id: 'understanding' as const, label: '项目理解', badge: inspect?.acceptedProjectFacts.length || null },
    { id: 'facts' as const, label: '项目记忆', badge: factCount || null },
    { id: 'current' as const, label: '当前上下文', badge: inspect?.bundle?.sections.length ?? null },
    { id: 'team' as const, label: '团队沉淀', badge: teamCount || null },
    { id: 'status' as const, label: '引擎状态', badge: providerHealth?.length || null },
  ]
}

function ContextProjectUnderstandingPanel({ payload, loading, error }: {
  payload: ContextInspectPayload | null
  loading: boolean
  error: string | null
}) {
  if (loading) return <PanelState title="正在读取项目理解" message="正在读取已接受的项目事实。" />
  if (error) return <PanelState title="项目理解暂不可用" message={error} />
  const facts = payload?.acceptedProjectFacts ?? []
  return (
    <PanelFrame title="项目理解" subtitle={`${facts.length} 条已接受项目事实`}>
      {facts.length === 0 ? (
        <PanelState title="暂无项目理解" message="当前项目还没有可展示的持久事实。" />
      ) : (
        <div className="space-y-2">
          {facts.map((fact) => (
            <article key={fact.id} className="rounded-[8px] border border-[var(--border)] bg-[var(--bg)] p-2">
              <div className="flex flex-wrap items-center gap-1">
                <Badge tone="accent">{kindLabel(fact.kind)}</Badge>
                <Badge>可信度 {formatPercent(fact.confidence)}</Badge>
                <Badge>新鲜度 {freshnessLabel(fact.freshness)}</Badge>
              </div>
              <div className="mt-1 text-[12px] leading-relaxed text-[var(--text)]">{fact.content}</div>
            </article>
          ))}
        </div>
      )}
    </PanelFrame>
  )
}

function ContextTeamPlaceholder({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) return <PanelState title="正在读取团队沉淀" message="正在读取 Team/PM/Worker 产生的项目事实。" />
  if (error) return <PanelState title="团队沉淀暂不可用" message={error} />
  return (
    <PanelFrame title="团队沉淀" subtitle="已接受团队事实">
      <PanelState title="暂无团队沉淀" message="Team/PM/Worker 还没有产出可复用的项目事实。" />
    </PanelFrame>
  )
}

function isTeamFactKind(kind: string): boolean {
  return kind === 'team_decision' || kind === 'task_result' || kind === 'artifact_summary' || kind === 'qa_issue'
}
