import { create } from 'zustand'
import { ipc } from '../lib/ipc-client'

export type ThemeMode = 'dark'
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

function applyTheme() {
  document.documentElement.dataset.theme = 'dark'
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  config: null,
  isOpen: false,
  activeTab: 'models',
  theme: 'dark',

  open: (tab) => set({ isOpen: true, activeTab: tab || get().activeTab }),
  close: () => set({ isOpen: false }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  setTheme: (theme) => {
    applyTheme()
    set({ theme: 'dark' })
    ipc.config.set({ theme: 'dark' } as any)
  },

  load: async () => {
    const config = await ipc.config.get()
    applyTheme()
    if ((config as any)?.theme !== 'dark') {
      await ipc.config.set({ theme: 'dark' } as any)
    }
    set({ config, theme: 'dark' })
  },

  save: async (config: any) => {
    await ipc.config.set(config)
    set({ config, isOpen: false })
  },
}))
