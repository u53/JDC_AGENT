import { create } from 'zustand'

export interface GeneratedImage {
  path: string
  width?: number
  height?: number
  bytes: number
  format: string
  background: string
  transparent: boolean
  downloadError?: string
}

interface ImageState {
  byTask: Record<string, Record<string, GeneratedImage[]>>
  addGenerated: (sessionId: string, taskId: string, images: GeneratedImage[]) => void
  getForSession: (sessionId: string) => Record<string, GeneratedImage[]>
}

export const useImageStore = create<ImageState>((set, get) => ({
  byTask: {},
  addGenerated: (sessionId, taskId, images) =>
    set((s) => ({
      byTask: {
        ...s.byTask,
        [sessionId]: { ...(s.byTask[sessionId] ?? {}), [taskId]: images },
      },
    })),
  getForSession: (sessionId) => get().byTask[sessionId] ?? {},
}))
