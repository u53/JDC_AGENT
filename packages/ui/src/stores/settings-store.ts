import { create } from 'zustand'
import { ipc } from '../lib/ipc-client'

export type ThemeMode = 'light' | 'dark' | 'system' | 'ocean' | 'purple' | 'cyber' | 'warm'
export type SettingsTab = 'models' | 'mcp' | 'tools' | 'shortcuts' | 'advanced'

interface SettingsState {
  config: any | null
  isOpen: boolean
  activeTab: SettingsTab
  theme: ThemeMode

  open: (tab?: SettingsTab) => void
  close: () => void
  setActiveTab: (tab: SettingsTab) => void
  setTheme: (theme: ThemeMode) => void
  load: () => Promise<void>
  save: (config: any) => Promise<void>
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  config: null,
  isOpen: false,
  activeTab: 'models',
  theme: 'system',

  open: (tab) => set({ isOpen: true, activeTab: tab || get().activeTab }),
  close: () => set({ isOpen: false }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
    ipc.config.set({ theme } as any)
  },

  load: async () => {
    const config = await ipc.config.get()
    const theme = (config as any)?.theme || 'system'
    applyTheme(theme)
    set({ config, theme })
  },

  save: async (config: any) => {
    await ipc.config.set(config)
    set({ config, isOpen: false })
  },
}))
