import { create } from 'zustand'

export type ToastVariant = 'success' | 'error' | 'info'

export interface Toast {
  id: string
  message: string
  variant: ToastVariant
  createdAt: number
}

interface ToastStoreState {
  toasts: Toast[]
  showToast: (message: string, variant?: ToastVariant, durationMs?: number) => void
  dismissToast: (id: string) => void
}

export const useToastStore = create<ToastStoreState>((set, get) => ({
  toasts: [],

  showToast: (message, variant = 'success', durationMs = 2000) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const toast: Toast = { id, message, variant, createdAt: Date.now() }
    set((s) => ({ toasts: [...s.toasts, toast] }))
    setTimeout(() => {
      get().dismissToast(id)
    }, durationMs)
  },

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}))
