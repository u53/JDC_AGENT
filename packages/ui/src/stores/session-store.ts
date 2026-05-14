import { create } from 'zustand'
import { ipc } from '../lib/ipc-client'
import type { ToolExecutionEvent } from '@jdcagnet/core'

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

export interface SessionStreamState {
  isStreaming: boolean
  streamingText: string
  thinkingText: string
  isThinking: boolean
  toolEvents: ToolExecutionEvent[]
  error?: { message: string; category: string; retrying: boolean; retryAttempt?: number; retryIn?: number }
  finished?: boolean
  usage?: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; totalTokens: number; cacheHitRate: number; contextUsedPercent: number; turnCount: number }
}

const EMPTY_STREAM_STATE: SessionStreamState = {
  isStreaming: false,
  streamingText: '',
  thinkingText: '',
  isThinking: false,
  toolEvents: [],
}

interface SessionState {
  projects: ProjectGroup[]
  activeSessionId: string | null
  messages: any[]
  isLoading: boolean
  sessionStates: Record<string, SessionStreamState>
  tasks: Array<{ id: string; subject: string; description: string; status: string }>
  loadProjects: () => Promise<void>
  createSession: (cwd: string) => Promise<void>
  switchSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  addProject: () => Promise<void>
  getSessionState: (sessionId: string) => SessionStreamState
  updateSessionState: (sessionId: string, update: Partial<SessionStreamState>) => void
  appendStreamText: (sessionId: string, text: string) => void
  appendThinkingText: (sessionId: string, text: string) => void
  addToolEvent: (sessionId: string, event: ToolExecutionEvent) => void
  markStreaming: (sessionId: string, streaming: boolean) => void
  setError: (sessionId: string, error: { message: string; category: string; retrying: boolean; retryAttempt?: number; retryIn?: number } | null) => void
  clearSessionStreamState: (sessionId: string) => void
  finishSession: (sessionId: string) => void
  dismissFinished: (sessionId: string) => void
  updateUsage: (sessionId: string, usage: SessionStreamState['usage']) => void
  loadTasks: (sessionId: string) => Promise<void>
}

export const useSessionStore = create<SessionState>((set, get) => ({
  projects: [],
  activeSessionId: null,
  messages: [],
  isLoading: false,
  sessionStates: {},
  tasks: [],

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
    const { messages, usage } = await ipc.session.switch(sessionId)
    set((s) => ({
      activeSessionId: sessionId,
      messages,
      isLoading: false,
      sessionStates: {
        ...s.sessionStates,
        ...(usage ? { [sessionId]: { ...(s.sessionStates[sessionId] || EMPTY_STREAM_STATE), usage } } : {}),
      },
    }))
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

  getSessionState: (sessionId: string) => {
    return get().sessionStates[sessionId] || EMPTY_STREAM_STATE
  },

  updateSessionState: (sessionId: string, update: Partial<SessionStreamState>) => {
    set((s) => ({
      sessionStates: {
        ...s.sessionStates,
        [sessionId]: { ...(s.sessionStates[sessionId] || EMPTY_STREAM_STATE), ...update },
      },
    }))
  },

  appendStreamText: (sessionId: string, text: string) => {
    set((s) => {
      const current = s.sessionStates[sessionId] || EMPTY_STREAM_STATE
      return {
        sessionStates: {
          ...s.sessionStates,
          [sessionId]: { ...current, streamingText: current.streamingText + text, isThinking: false },
        },
      }
    })
  },

  appendThinkingText: (sessionId: string, text: string) => {
    set((s) => {
      const current = s.sessionStates[sessionId] || EMPTY_STREAM_STATE
      return {
        sessionStates: {
          ...s.sessionStates,
          [sessionId]: { ...current, thinkingText: current.thinkingText + text, isThinking: true },
        },
      }
    })
  },

  addToolEvent: (sessionId: string, event: ToolExecutionEvent) => {
    set((s) => {
      const current = s.sessionStates[sessionId] || EMPTY_STREAM_STATE
      return {
        sessionStates: {
          ...s.sessionStates,
          [sessionId]: { ...current, toolEvents: [...current.toolEvents, event] },
        },
      }
    })
  },

  markStreaming: (sessionId: string, streaming: boolean) => {
    set((s) => {
      const current = s.sessionStates[sessionId] || EMPTY_STREAM_STATE
      return {
        sessionStates: {
          ...s.sessionStates,
          [sessionId]: { ...current, isStreaming: streaming },
        },
      }
    })
  },

  setError: (sessionId, error) => set((s) => {
    const current = s.sessionStates[sessionId] || EMPTY_STREAM_STATE
    return {
      sessionStates: {
        ...s.sessionStates,
        [sessionId]: { ...current, error: error || undefined },
      },
    }
  }),

  clearSessionStreamState: (sessionId: string) => {
    set((s) => {
      const current = s.sessionStates[sessionId]
      return {
        sessionStates: {
          ...s.sessionStates,
          [sessionId]: { ...EMPTY_STREAM_STATE, usage: current?.usage },
        },
      }
    })
  },

  finishSession: (sessionId: string) => {
    set((s) => {
      const current = s.sessionStates[sessionId] || EMPTY_STREAM_STATE
      return {
        sessionStates: {
          ...s.sessionStates,
          [sessionId]: { ...EMPTY_STREAM_STATE, finished: true, usage: current.usage },
        },
      }
    })
  },

  dismissFinished: (sessionId: string) => {
    set((s) => {
      const current = s.sessionStates[sessionId]
      if (!current) return s
      return {
        sessionStates: {
          ...s.sessionStates,
          [sessionId]: { ...current, finished: false },
        },
      }
    })
  },

  updateUsage: (sessionId: string, usage: SessionStreamState['usage']) => {
    set((s) => {
      const current = s.sessionStates[sessionId] || EMPTY_STREAM_STATE
      return {
        sessionStates: {
          ...s.sessionStates,
          [sessionId]: { ...current, usage },
        },
      }
    })
  },

  loadTasks: async (sessionId: string) => {
    const tasks = await (window as any).electronAPI?.invoke('session:get-tasks', { sessionId })
    if (tasks) set({ tasks })
  },
}))
