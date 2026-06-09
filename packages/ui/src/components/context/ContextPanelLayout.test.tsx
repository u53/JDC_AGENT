import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ContextPanelLayout, type ContextTab } from './ContextPanelLayout'

function request<T>(data: T | null = null) {
  return { data, loading: false, error: null, loadedAt: null }
}

describe('ContextPanelLayout', () => {
  it('renders the context inspector in the unified JDC dark panel shell', () => {
    const html = renderToStaticMarkup(
      <ContextPanelLayout
        sessionId="session-1"
        activeTab={'constraints' as ContextTab}
        onTabChange={() => {}}
        inspect={request()}
        harvest={request()}
        memoryReview={request()}
        providerHealth={request()}
        refresh={request()}
        constraint={request()}
        onReloadDiagnostics={() => {}}
        onReindexCode={() => {}}
        onReadProviderStatus={() => {}}
      />,
    )

    expect(html).toContain('context-panel-shell')
    expect(html).toContain('context-panel-header')
    expect(html).toContain('context-panel-tabs')
    expect(html).toContain('context-panel-body')
    expect(html).toContain('JDC 上下文引擎')
  })
})
