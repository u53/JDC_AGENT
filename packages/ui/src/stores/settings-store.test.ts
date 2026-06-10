import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from './settings-store'

describe('settings theme store', () => {
  const dataset: Record<string, string> = {}
  let savedConfig: Record<string, unknown>

  beforeEach(() => {
    savedConfig = {}
    for (const key of Object.keys(dataset)) delete dataset[key]

    const invoke = vi.fn(async (channel: string, data?: unknown) => {
      if (channel === 'config:get') return savedConfig
      if (channel === 'config:set') {
        savedConfig = { ...savedConfig, ...(data as Record<string, unknown>) }
        return { success: true }
      }
      return null
    })

    vi.stubGlobal('document', { documentElement: { dataset } })
    vi.stubGlobal('window', {
      electronAPI: { invoke },
      matchMedia: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    const initial = useSettingsStore.getInitialState()
    useSettingsStore.setState(initial, true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to following the system theme and resolves light systems to JDC Light', async () => {
    await useSettingsStore.getState().load()

    expect(useSettingsStore.getState().theme).toBe('system')
    expect(useSettingsStore.getState().resolvedTheme).toBe('light')
    expect(dataset.theme).toBe('light')
    expect(dataset.themePreference).toBe('system')
  })

  it('migrates the legacy forced dark default to system mode', async () => {
    savedConfig = { theme: 'dark' }

    await useSettingsStore.getState().load()

    expect(useSettingsStore.getState().theme).toBe('system')
    expect(useSettingsStore.getState().resolvedTheme).toBe('light')
    expect(dataset.themePreference).toBe('system')
  })

  it('persists an explicit JDC Light selection', () => {
    useSettingsStore.getState().setTheme('light')

    expect(useSettingsStore.getState().theme).toBe('light')
    expect(useSettingsStore.getState().resolvedTheme).toBe('light')
    expect(dataset.theme).toBe('light')
    expect(savedConfig.theme).toBe('light')
    expect(savedConfig.themePreferenceVersion).toBe(2)
  })
})
