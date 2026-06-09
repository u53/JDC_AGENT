import type { ConstraintObservabilitySnapshot, ContextInspectPayload } from '@jdcagnet/core'
import type { ContextHarvestQueue, ContextMemoryReview, ContextProviderHealth, ContextRefreshState, ContextRequestState } from '../../stores/context-store'
import { ContextAdvancedDiagnosticsPanel } from './ContextAdvancedDiagnosticsPanel'
import { ContextCurrentPanel } from './ContextCurrentPanel'
import { ContextFactsPanel } from './ContextFactsPanel'
import { ContextInspectPanel } from './ContextInspectPanel'
import { Badge, ContextMarkdown, formatPercent, freshnessLabel, kindLabel, PanelFrame, PanelState } from './ContextPanelPrimitives'
import { ContextTeamPanel } from './ContextTeamPanel'
import { ConstraintStatusPanel } from './ConstraintStatusPanel'

export type ContextTab = 'constraints' | 'understanding' | 'facts' | 'current' | 'team' | 'status' | 'advanced'

export function ContextPanelLayout({ sessionId, activeTab, onTabChange, inspect, harvest, memoryReview, providerHealth, refresh, constraint, advancedVisible = false, onReloadDiagnostics, onReindexCode, onReadProviderStatus }: {
  sessionId: string | null
  activeTab: ContextTab
  onTabChange: (tab: ContextTab) => void
  inspect: ContextRequestState<ContextInspectPayload>
  harvest: ContextRequestState<ContextHarvestQueue>
  memoryReview: ContextRequestState<ContextMemoryReview>
  providerHealth: ContextRequestState<ContextProviderHealth>
  refresh: ContextRequestState<ContextRefreshState>
  constraint: ContextRequestState<ConstraintObservabilitySnapshot>
  advancedVisible?: boolean
  onReloadDiagnostics: () => void
  onReindexCode: () => void
  onReadProviderStatus: () => void
}) {
  if (!sessionId) {
    return (
      <div className="p-3">
        <PanelState title="没有活动会话" message="上下文状态会在会话创建后显示。" />
      </div>
    )
  }

  const tabs = contextTabs(inspect.data, memoryReview.data, providerHealth.data, constraint.data)
  const effectiveTab = activeTab === 'advanced' && !advancedVisible ? 'constraints' : activeTab
  const status = contextEngineStatus(inspect, constraint)

  return (
    <div className="context-panel-shell flex h-full min-h-0 min-w-0 flex-col bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface)_96%,transparent),color-mix(in_srgb,var(--bg)_90%,transparent))]">
      <div className="context-panel-header flex-shrink-0 border-b border-[color-mix(in_srgb,var(--border)_86%,transparent)] bg-[color-mix(in_srgb,var(--surface)_32%,transparent)] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--accent)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_13%,transparent)]" />
              <div className="truncate font-mono text-[11px] font-semibold uppercase text-[var(--text)]">JDC 上下文引擎</div>
            </div>
            <div className="mt-1 truncate text-[10px] text-[var(--muted)]">Project context</div>
          </div>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
      </div>

      <div className="context-panel-tabs context-panel-scroll flex min-w-0 flex-shrink-0 gap-1 overflow-x-auto border-b border-[color-mix(in_srgb,var(--border)_86%,transparent)] bg-[color-mix(in_srgb,var(--surface)_24%,transparent)] px-3 py-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onTabChange(item.id)}
            className={`min-w-0 shrink-0 whitespace-nowrap rounded-[7px] border px-2 py-1.5 font-mono text-[11px] transition-colors active:translate-y-px ${effectiveTab === item.id ? 'border-[color-mix(in_srgb,var(--accent)_30%,var(--border))] bg-[color-mix(in_srgb,var(--accent)_9%,var(--surface-2))] text-[color-mix(in_srgb,var(--accent)_86%,var(--text)_14%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]' : 'border-transparent text-[var(--muted)] hover:border-[color-mix(in_srgb,var(--accent)_16%,var(--border))] hover:bg-[color-mix(in_srgb,var(--surface-2)_60%,transparent)] hover:text-[var(--text)]'}`}
          >
            {item.label}
            {item.badge != null && <span className="ml-1 text-[10px] opacity-70">{item.badge}</span>}
          </button>
        ))}
      </div>

      <div className="context-panel-body context-panel-scroll min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
        {effectiveTab === 'constraints' && <ConstraintStatusPanel snapshot={constraint.data} loading={constraint.loading} error={constraint.error} advancedVisible={advancedVisible} />}
        {effectiveTab === 'understanding' && <ContextProjectUnderstandingPanel payload={inspect.data} loading={inspect.loading} error={inspect.error} />}
        {effectiveTab === 'facts' && <ContextFactsPanel acceptedMemory={memoryReview.data?.accepted ?? null} projectFacts={inspect.data?.acceptedProjectFacts ?? []} loading={memoryReview.loading || inspect.loading} error={memoryReview.error ?? inspect.error} />}
        {effectiveTab === 'current' && <ContextCurrentPanel payload={inspect.data} loading={inspect.loading} error={inspect.error} />}
        {effectiveTab === 'team' && <ContextTeamPanel payload={inspect.data} loading={inspect.loading} error={inspect.error} />}
        {effectiveTab === 'status' && <ContextInspectPanel payload={inspect.data} loading={inspect.loading} error={inspect.error} />}
        {advancedVisible && activeTab === 'advanced' && (
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

function contextTabs(inspect: ContextInspectPayload | null, memoryReview: ContextMemoryReview | null, providerHealth: ContextProviderHealth | null, constraint: ConstraintObservabilitySnapshot | null) {
  const factCount = (memoryReview?.accepted?.results.length ?? 0) + (inspect?.acceptedProjectFacts.length ?? 0)
  const teamCount = (inspect?.acceptedProjectFacts ?? []).filter((fact) => isTeamFactKind(fact.kind)).length
  return [
    { id: 'constraints' as const, label: '约束状态', badge: constraintBadge(constraint) },
    { id: 'understanding' as const, label: '项目理解', badge: inspect?.acceptedProjectFacts.length || null },
    { id: 'facts' as const, label: '项目记忆', badge: factCount || null },
    { id: 'current' as const, label: '当前上下文', badge: inspect?.bundle?.sections.length ?? null },
    { id: 'team' as const, label: '团队沉淀', badge: teamCount || null },
    { id: 'status' as const, label: '引擎状态', badge: providerHealth?.length || null },
  ]
}

function contextEngineStatus(
  inspect: ContextRequestState<ContextInspectPayload>,
  constraint: ContextRequestState<ConstraintObservabilitySnapshot>,
): { label: string; tone: 'muted' | 'good' | 'warn' | 'bad' | 'accent' } {
  if (inspect.loading || constraint.loading) return { label: '读取中', tone: 'accent' }
  if (inspect.error || constraint.error) return { label: '异常', tone: 'bad' }
  if (constraint.data?.blockedActions.length) return { label: '已拦截', tone: 'bad' }
  if (constraint.data?.status === 'needs_evidence' || constraint.data?.status === 'needs_verification') return { label: '待处理', tone: 'warn' }
  if (inspect.data?.status === 'available' || constraint.data?.status === 'verified') return { label: '可用', tone: 'good' }
  if (inspect.data?.status === 'disabled') return { label: '关闭', tone: 'muted' }
  return { label: '待机', tone: 'muted' }
}

function constraintBadge(snapshot: ConstraintObservabilitySnapshot | null): string | number | null {
  if (!snapshot) return null
  if (snapshot.blockedActions.length > 0) return snapshot.blockedActions.length
  if (snapshot.evidence.missing.length > 0) return snapshot.evidence.missing.length
  if (snapshot.verification.changedFiles.length > 0) return snapshot.verification.changedFiles.length
  return snapshot.status === 'verified' ? '已验' : null
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
            <article key={fact.id} className="rounded-[8px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_42%,transparent)] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
              <div className="flex flex-wrap items-center gap-1">
                <Badge tone="accent">{kindLabel(fact.kind)}</Badge>
                <Badge>可信度 {formatPercent(fact.confidence)}</Badge>
                <Badge>新鲜度 {freshnessLabel(fact.freshness)}</Badge>
              </div>
              <ContextMarkdown content={fact.content} />
            </article>
          ))}
        </div>
      )}
    </PanelFrame>
  )
}

function isTeamFactKind(kind: string): boolean {
  return kind === 'team_decision' || kind === 'task_result' || kind === 'artifact_summary' || kind === 'qa_issue'
}
