import { create } from 'zustand'
import { ipc } from '../lib/ipc-client'

export interface ModelEntry {
  id: string
  modelId: string
  name: string
  contextWindow: number
  maxTokens: number
  compressAt: number
}

export type ApiProtocol = 'anthropic' | 'openai' | 'openai-responses'

export interface ModelGroup {
  id: string
  name: string
  protocol: ApiProtocol  // API 协议格式
  baseUrl: string
  apiKey: string
  models: ModelEntry[]
}

interface ModelState {
  groups: ModelGroup[]
  activeModelId: string | null

  addGroup: (name: string, protocol: ApiProtocol, baseUrl: string, apiKey: string) => void
  removeGroup: (groupId: string) => void
  updateGroup: (groupId: string, updates: Partial<Omit<ModelGroup, 'id' | 'models'>>) => void
  addModel: (groupId: string, model: Omit<ModelEntry, 'id'>) => void
  updateModel: (groupId: string, modelId: string, updates: Partial<Omit<ModelEntry, 'id'>>) => void
  removeModel: (groupId: string, modelId: string) => void
  setActiveModel: (modelId: string) => void
  getActiveModel: () => { model: ModelEntry; group: ModelGroup } | null
  loadFromConfig: () => Promise<void>
  saveToConfig: () => Promise<void>
}

export const useModelStore = create<ModelState>((set, get) => ({
  groups: [],
  activeModelId: null,

  addGroup: (name, protocol, baseUrl, apiKey) => {
    const group: ModelGroup = {
      id: crypto.randomUUID(),
      name,
      protocol,
      baseUrl,
      apiKey,
      models: [],
    }
    set((s) => ({ groups: [...s.groups, group] }))
    get().saveToConfig()
  },

  removeGroup: (groupId) => {
    set((s) => ({ groups: s.groups.filter((g) => g.id !== groupId) }))
    get().saveToConfig()
  },

  updateGroup: (groupId, updates) => {
    set((s) => ({
      groups: s.groups.map((g) => (g.id === groupId ? { ...g, ...updates } : g)),
    }))
    get().saveToConfig()
  },

  addModel: (groupId, model) => {
    const entry: ModelEntry = { ...model, id: crypto.randomUUID() }
    set((s) => ({
      groups: s.groups.map((g) =>
        g.id === groupId ? { ...g, models: [...g.models, entry] } : g
      ),
    }))
    get().saveToConfig()
  },

  updateModel: (groupId, modelId, updates) => {
    set((s) => ({
      groups: s.groups.map((g) =>
        g.id === groupId
          ? { ...g, models: g.models.map((m) => m.id === modelId ? { ...m, ...updates } : m) }
          : g
      ),
    }))
    get().saveToConfig()
  },

  removeModel: (groupId, modelId) => {
    set((s) => ({
      groups: s.groups.map((g) =>
        g.id === groupId ? { ...g, models: g.models.filter((m) => m.id !== modelId) } : g
      ),
    }))
    const { activeModelId } = get()
    if (activeModelId === modelId) {
      set({ activeModelId: null })
    }
    get().saveToConfig()
  },

  setActiveModel: (modelId) => {
    set({ activeModelId: modelId })
    get().saveToConfig()
  },

  getActiveModel: () => {
    const { groups, activeModelId } = get()
    if (!activeModelId) return null
    for (const group of groups) {
      const model = group.models.find((m) => m.id === activeModelId)
      if (model) return { model, group }
    }
    return null
  },

  loadFromConfig: async () => {
    const config = await ipc.config.get()
    const data = (config as any)?.modelGroups
    if (data) {
      set({ groups: data.groups || [], activeModelId: data.activeModelId || null })
    }
  },

  saveToConfig: async () => {
    const { groups, activeModelId } = get()
    await ipc.config.set({ modelGroups: { groups, activeModelId } } as any)
  },
}))
