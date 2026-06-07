import type { ContextRefreshInput } from '@jdcagnet/core'
import { useEffect, useState } from 'react'
import { useContextStore } from '../../stores/context-store'
import { ContextPanelLayout, type ContextTab } from './ContextPanelLayout'

export function ContextPanel({ sessionId }: { sessionId: string | null }) {
  const [tab, setTab] = useState<ContextTab>('constraints')
  const inspect = useContextStore((state) => state.inspect)
  const harvest = useContextStore((state) => state.harvest)
  const memoryReview = useContextStore((state) => state.memoryReview)
  const providerHealth = useContextStore((state) => state.providerHealth)
  const refresh = useContextStore((state) => state.refresh)
  const constraint = useContextStore((state) => state.constraint)
  const loadProjectContext = useContextStore((state) => state.loadProjectContext)
  const loadInspect = useContextStore((state) => state.loadInspect)
  const loadProviderHealth = useContextStore((state) => state.loadProviderHealth)
  const refreshProviders = useContextStore((state) => state.refreshProviders)
  const reset = useContextStore((state) => state.reset)

  useEffect(() => {
    setTab('constraints')
    if (!sessionId) {
      reset()
      return
    }
    loadProjectContext({ sessionId })
  }, [loadProjectContext, reset, sessionId])

  const reloadDiagnostics = () => {
    if (!sessionId) return
    loadInspect({ sessionId, includeExpiredRejected: true, includeAdvancedDiagnostics: true })
  }

  const reindexCode = () => {
    if (!sessionId) return
    refreshProviders({ sessionId, providers: ['code'], reindex: true, userMessage: '后台重建代码索引', mode: 'debug' } satisfies ContextRefreshInput)
  }

  const readProviderStatus = () => {
    if (!sessionId) return
    loadProviderHealth({ sessionId, userMessage: '读取提供方状态', mode: 'debug' } satisfies ContextRefreshInput)
  }

  return (
    <ContextPanelLayout
      sessionId={sessionId}
      activeTab={tab}
      onTabChange={setTab}
      inspect={inspect}
      harvest={harvest}
      memoryReview={memoryReview}
      providerHealth={providerHealth}
      refresh={refresh}
      constraint={constraint}
      advancedVisible={import.meta.env.DEV === true}
      onReloadDiagnostics={reloadDiagnostics}
      onReindexCode={reindexCode}
      onReadProviderStatus={readProviderStatus}
    />
  )
}
