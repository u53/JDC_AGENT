import { create } from 'zustand'
import { ipc } from '../lib/ipc-client'

interface Session {
  id: string
  projectName: string
  cwd: string
}

interface ProjectGroup {
  name: string
  cwd: string
  sessions: Session[]
}

interface SessionState {
  projects: ProjectGroup[]
  activeSessionId: string | null
  messages: any[]
  isLoading: boolean
  loadProjects: () => Promise<void>
  createSession: (cwd: string) => Promise<void>
  switchSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  addProject: () => Promise<void>
}

export const useSessionStore = create<SessionState>((set, get) => ({
  projects: [],
  activeSessionId: null,
  messages: [],
  isLoading: false,

  loadProjects: async () => {
    const projects = await ipc.session.list()
    set({ projects: projects || [] })
  },

  createSession: async (cwd: string) => {
    const projectName = cwd.split('/').filter(Boolean).pop() || 'untitled'
    const { sessionId } = await ipc.session.create(projectName, cwd)
    set({ activeSessionId: sessionId, messages: [] })
    await get().loadProjects()
  },

  switchSession: async (sessionId: string) => {
    set({ isLoading: true })
    const { messages } = await ipc.session.switch(sessionId)
    set({ activeSessionId: sessionId, messages, isLoading: false })
  },

  deleteSession: async (sessionId: string) => {
    await ipc.session.delete(sessionId)
    if (get().activeSessionId === sessionId) {
      set({ activeSessionId: null, messages: [] })
    }
    await get().loadProjects()
  },

  addProject: async () => {
    const result = await ipc.dialog.openFolder()
    if (result?.path) {
      await get().createSession(result.path)
    }
  },
}))
