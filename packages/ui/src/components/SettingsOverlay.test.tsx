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
    expect(html).toContain('settings-overlay-soft')
    expect(html).toContain('z-[110]')
    expect(html).toContain('settings-shell')
    expect(html).toContain('settings-shell-soft')
    expect(html).toContain('h-[min(720px,86vh)]')
    expect(html).toContain('settings-nav')
    expect(html).toContain('settings-content')
    expect(html).toContain('Settings')
    expect(html).toContain('模型')
    expect(html).not.toContain('bg-black/70')
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
    expect(html).toContain('settings-model-manager')
    expect(html).toContain('settings-model-search')
    expect(html).toContain('settings-model-group-body')
    expect(html).toContain('settings-field-grid')
    expect(html).toContain('settings-model-row')
    expect(html).toContain('settings-protocol-select')
    expect(html).toContain('settings-model-count')
    expect(html).toContain('Production')
    expect(html).toContain('1 model')
    expect(html).not.toContain('<select')
  })

  it('lets compact protocol menus escape collapsed model group cards', () => {
    const modelState = {
      groups: [{
        id: 'group-1',
        name: 'Production',
        protocol: 'openai-responses' as const,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        models: [],
      }],
      activeModelId: null,
    }
    useModelStore.setState(modelState)
    Object.assign(useModelStore.getInitialState(), modelState)

    const html = renderToStaticMarkup(<SettingsOverlay />)

    expect(html).toContain('settings-model-group-card overflow-visible')
    expect(html).not.toContain('settings-model-group-card overflow-hidden')
  })

  it('renders Feishu settings with multiple bot bindings', () => {
    const settingsState = { isOpen: true, activeTab: 'feishu' as const, theme: 'dark' as const, config: null }
    useSettingsStore.setState(settingsState)
    Object.assign(useSettingsStore.getInitialState(), settingsState)

    const html = renderToStaticMarkup(<SettingsOverlay />)

    expect(html).toContain('飞书')
    expect(html).toContain('添加机器人')
    expect(html).toContain('App ID')
    expect(html).toContain('项目路径')
  })

  it('renders a Chinese product introduction in the about section', () => {
    const settingsState = { isOpen: true, activeTab: 'advanced' as const, theme: 'dark' as const, config: null }
    useSettingsStore.setState(settingsState)
    Object.assign(useSettingsStore.getInitialState(), settingsState)

    const html = renderToStaticMarkup(<SettingsOverlay />)

    expect(html).toContain('JDC Code 是一款面向真实开发工作的 AI 编程助手')
    expect(html).toContain('上下文、权限、模型与多代理协作')
    expect(html).toContain('settings-about-hero')
    expect(html).toContain('settings-about-grid')
    expect(html).toContain('Fresh-read 约束')
    expect(html).toContain('Evidence-first')
    expect(html).toContain('Team / Sub-agent')
    expect(html).not.toContain('AI-powered coding assistant')
  })
})
