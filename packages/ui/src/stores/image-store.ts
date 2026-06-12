import { create } from 'zustand'

export interface GeneratedImage {
  path: string
  width?: number
  height?: number
  bytes: number
  format: string
  downloadError?: string
}

export interface TaskGeneratedImages {
  images: GeneratedImage[]
  error?: string
}

interface ImageState {
  byTask: Record<string, Record<string, TaskGeneratedImages>>
  addGenerated: (sessionId: string, taskId: string, images: GeneratedImage[], error?: string) => void
}

export const useImageStore = create<ImageState>((set) => ({
  byTask: {},
  addGenerated: (sessionId, taskId, images, error) =>
    set((s) => ({
      byTask: {
        ...s.byTask,
        [sessionId]: { ...(s.byTask[sessionId] ?? {}), [taskId]: { images, error } },
      },
    })),
}))
