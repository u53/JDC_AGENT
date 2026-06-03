import type { ContextInspectPayload } from '@jdcagnet/core'
import type { ContextHarvestQueue, ContextMemoryReview, ContextProviderHealth, ContextRefreshState, ContextRequestState } from '../../stores/context-store'
import { ContextAdvancedDiagnosticsPanel } from './ContextAdvancedDiagnosticsPanel'
import { ContextCurrentPanel } from './ContextCurrentPanel'
import { ContextFactsPanel } from './ContextFactsPanel'
import { ContextInspectPanel } from './ContextInspectPanel'

export type ContextTab = 'status' | 'facts' | 'current' | 'advanced'

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
        {activeTab === 'status' && <ContextInspectPanel payload={inspect.data} loading={inspect.loading} error={inspect.error} />}
        {activeTab === 'facts' && <ContextFactsPanel acceptedMemory={memoryReview.data?.accepted ?? null} projectFacts={inspect.data?.acceptedProjectFacts ?? []} loading={memoryReview.loading || inspect.loading} error={memoryReview.error ?? inspect.error} />}
        {activeTab === 'current' && <ContextCurrentPanel payload={inspect.data} loading={inspect.loading} error={inspect.error} />}
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
  const diagnosticsCount = (inspect?.diagnostics.length ?? 0) + (inspect?.bundle?.diagnostics.length ?? 0) + (inspect?.advancedDiagnostics?.diagnostics.length ?? 0)
  return [
    { id: 'status' as const, label: '当前状态', badge: inspect?.status === 'available' ? '可用' : inspect?.status ? null : null },
    { id: 'facts' as const, label: '项目记忆', badge: factCount || null },
    { id: 'current' as const, label: '当前上下文', badge: inspect?.bundle?.sections.length ?? null },
    { id: 'advanced' as const, label: '高级诊断', badge: diagnosticsCount || providerHealth?.length || null },
  ]
}
