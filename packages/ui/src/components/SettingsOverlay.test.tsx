import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSettingsStore } from '../stores/settings-store'
import { useModelStore } from '../stores/model-store'
import { SettingsOverlay } from './SettingsOverlay'

describe('SettingsOverlay', () => {
  beforeEach(() => {
    const settingsState = { isOpen: true, activeTab: 'models' as const, theme: 'dark' as const, config: null }
    useSettingsStore.setState(settingsState)
    Object.assign(useSettingsStore.getInitialState(), settingsState)
    useModelStore.setState({ groups: [], activeModelId: null })
  })

  it('renders settings in a JDC dark shell with rail navigation', () => {
    const html = renderToStaticMarkup(<SettingsOverlay />)

    expect(html).toContain('settings-overlay')
    expect(html).toContain('settings-shell')
    expect(html).toContain('settings-nav')
    expect(html).toContain('settings-content')
    expect(html).toContain('Settings')
    expect(html).toContain('模型')
  })

  it('renders the models tab with a composed action area and empty state', () => {
    const html = renderToStaticMarkup(<SettingsOverlay />)

    expect(html).toContain('settings-tab-body')
    expect(html).toContain('settings-section')
    expect(html).toContain('settings-primary-action')
    expect(html).toContain('settings-empty-state')
    expect(html).toContain('暂无模型分组')
  })

  it('renders configured model groups as compact settings cards', () => {
    const modelState = {
      groups: [{
        id: 'group-1',
        name: 'Production',
        protocol: 'openai-responses' as const,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        models: [{
          id: 'model-1',
          name: 'GPT 5.5',
          modelId: 'gpt-5.5',
          contextWindow: 200000,
          maxTokens: 32000,
          compressAt: 0.9,
        }],
      }],
      activeModelId: 'model-1',
    }
    useModelStore.setState(modelState)
    Object.assign(useModelStore.getInitialState(), modelState)

    const html = renderToStaticMarkup(<SettingsOverlay />)

    expect(html).toContain('settings-model-group-card')
    expect(html).toContain('settings-model-count')
    expect(html).toContain('Production')
    expect(html).toContain('1 model')
  })
})
