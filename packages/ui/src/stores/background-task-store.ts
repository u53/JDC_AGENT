import { create } from 'zustand'

export interface BackgroundTaskItem {
  id: string
  type: 'shell' | 'agent' | 'team'
  status: 'running' | 'completed' | 'failed'
  command?: string
  prompt?: string
  agentType?: string
  startedAt: number
  completedAt?: number
  exitCode?: number
  result?: string
  turns?: number
  toolsUsed?: string[]
}

interface BackgroundTaskStoreState {
  tasks: BackgroundTaskItem[]
  setTasks: (tasks: BackgroundTaskItem[]) => void
  updateTask: (id: string, updates: Partial<BackgroundTaskItem>) => void
  removeTask: (id: string) => void
  reset: () => void
}

export const useBackgroundTaskStore = create<BackgroundTaskStoreState>((set) => ({
  tasks: [],
  setTasks: (tasks) => set({ tasks }),
  updateTask: (id, updates) => set((s) => ({
    tasks: s.tasks.map(t => t.id === id ? { ...t, ...updates } : t),
  })),
  removeTask: (id) => set((s) => ({
    tasks: s.tasks.filter(t => t.id !== id),
  })),
  reset: () => set({ tasks: [] }),
}))
