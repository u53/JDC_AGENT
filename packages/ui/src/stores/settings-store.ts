import { create } from 'zustand'
import { ipc } from '../lib/ipc-client'

export type ResolvedTheme = 'dark' | 'light'
export type ThemeMode = 'system' | ResolvedTheme
export type SettingsTab = 'models' | 'mcp' | 'tools' | 'shortcuts' | 'advanced' | 'image'

interface SettingsState {
  config: any | null
  isOpen: boolean
  activeTab: SettingsTab
  theme: ThemeMode
  resolvedTheme: ResolvedTheme

  open: (tab?: SettingsTab) => void
  close: () => void
  setActiveTab: (tab: SettingsTab) => void
  setTheme: (theme: ThemeMode) => void
  load: () => Promise<void>
  save: (config: any) => Promise<void>
}

const SYSTEM_THEME_QUERY = '(prefers-color-scheme: light)'
const THEME_PREFERENCE_VERSION = 2

let stopSystemThemeListener: (() => void) | null = null

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'dark' || value === 'light'
}

function readThemeMode(config: any): ThemeMode {
  if (!isThemeMode(config?.theme)) return 'system'
  if (config.theme === 'dark' && config.themePreferenceVersion !== THEME_PREFERENCE_VERSION) {
    return 'system'
  }
  return config.theme
}

export function resolveTheme(theme: ThemeMode): ResolvedTheme {
  if (theme !== 'system') return theme
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark'
  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? 'light' : 'dark'
}

export function applyTheme(theme: ThemeMode): ResolvedTheme {
  const resolvedTheme = resolveTheme(theme)
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.dataset.themePreference = theme
  }
  return resolvedTheme
}

function watchSystemTheme(theme: ThemeMode, onChange: (resolvedTheme: ResolvedTheme) => void) {
  stopSystemThemeListener?.()
  stopSystemThemeListener = null

  if (theme !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

  const media = window.matchMedia(SYSTEM_THEME_QUERY)
  const handleChange = () => {
    onChange(applyTheme('system'))
  }

  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', handleChange)
    stopSystemThemeListener = () => media.removeEventListener('change', handleChange)
  } else if (typeof media.addListener === 'function') {
    media.addListener(handleChange)
    stopSystemThemeListener = () => media.removeListener(handleChange)
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  config: null,
  isOpen: false,
  activeTab: 'models',
  theme: 'system',
  resolvedTheme: resolveTheme('system'),

  open: (tab) => set({ isOpen: true, activeTab: tab || get().activeTab }),
  close: () => set({ isOpen: false }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  setTheme: (theme) => {
    const resolvedTheme = applyTheme(theme)
    watchSystemTheme(theme, (nextResolvedTheme) => set({ resolvedTheme: nextResolvedTheme }))
    set({ theme, resolvedTheme })
    ipc.config.set({ theme, themePreferenceVersion: THEME_PREFERENCE_VERSION } as any)
  },

  load: async () => {
    const config = await ipc.config.get()
    const theme = readThemeMode(config)
    const resolvedTheme = applyTheme(theme)
    watchSystemTheme(theme, (nextResolvedTheme) => set({ resolvedTheme: nextResolvedTheme }))
    set({ config, theme, resolvedTheme })
  },

  save: async (config: any) => {
    await ipc.config.set(config)
    set({ config, isOpen: false })
  },
}))
