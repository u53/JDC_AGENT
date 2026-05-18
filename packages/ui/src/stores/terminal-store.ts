import { create } from 'zustand'

interface TerminalState {
  visible: boolean
  height: number
  terminalId: string | null
  toggle: () => void
  show: () => void
  hide: () => void
  setHeight: (h: number) => void
  setTerminalId: (id: string | null) => void
}

export const useTerminalStore = create<TerminalState>((set) => ({
  visible: false,
  height: 200,
  terminalId: null,
  toggle: () => set((s) => ({ visible: !s.visible })),
  show: () => set({ visible: true }),
  hide: () => set({ visible: false }),
  setHeight: (height) => set({ height: Math.max(100, Math.min(height, window.innerHeight * 0.6)) }),
  setTerminalId: (terminalId) => set({ terminalId }),
}))
