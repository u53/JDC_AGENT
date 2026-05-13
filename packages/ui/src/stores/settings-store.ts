import { create } from 'zustand'
import { ipc } from '../lib/ipc-client'

interface SettingsState {
  config: any | null
  isOpen: boolean
  open: () => void
  close: () => void
  load: () => Promise<void>
  save: (config: any) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  config: null,
  isOpen: false,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),

  load: async () => {
    const config = await ipc.config.get()
    set({ config })
  },

  save: async (config: any) => {
    await ipc.config.set(config)
    set({ config, isOpen: false })
  },
}))
