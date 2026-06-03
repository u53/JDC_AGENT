import { create } from 'zustand'
import { ipc } from '../lib/ipc-client'
import { useIdeStore } from './ide-store'
import { useTeamStore } from './team-store'
import { useBackgroundTaskStore } from './background-task-store'
import { useModelStore } from './model-store'
import type { ToolExecutionEvent } from '@jdcagnet/core'

interface Session {
  id: string
  projectName: string
  cwd: string
  title?: string | null
}

interface ProjectGroup {
  name: string
  cwd: string
  sessions: Session[]
}

export interface SessionStreamState {
  isStreaming: boolean
  aborting?: boolean
  streamingText: string
  thinkingText: string
  isThinking: boolean
  toolEvents: ToolExecutionEvent[]
  compacting?: boolean
  error?: { message: string; category: string; retrying: boolean; retryAttempt?: number; retryIn?: number }
  finished?: boolean
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheCreationTokens: number
    cacheReadTokens: number
    totalTokens: number
    cacheHitRate: number
    contextUsedPercent: number
    turnCount: number
    subAgentInputTokens?: number
    subAgentOutputTokens?: number
    subAgentCacheCreationTokens?: number
    subAgentCacheReadTokens?: number
    subAgentTotalTokens?: number
    subAgentTurnCount?: number
    grandInputTokens?: number
    grandOutputTokens?: number
    grandTotalTokens?: number
  }
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
  messageQueue: string[]
  drafts: Record<string, ComposerDraft>
  enqueueMessage: (text: string) => void
  dequeueMessage: () => string | undefined
  removeFromQueue: (index: number) => void
  setDraftText: (sessionId: string, text: string) => void
  setDraftImages: (sessionId: string, images: { data: string; mediaType: string }[]) => void
  clearDraft: (sessionId: string) => void
  getDraft: (sessionId: string) => ComposerDraft
  loadProjects: () => Promise<void>
  createSession: (cwd: string) => Promise<void>
  switchSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>
  addProject: () => Promise<void>
  getSessionState: (sessionId: string) => SessionStreamState
  updateSessionState: (sessionId: string, update: Partial<SessionStreamState>) => void
  appendStreamText: (sessionId: string, text: string) => void
  appendThinkingText: (sessionId: string, text: string) => void
  flushSessionStreamBuffers: (sessionId: string) => void
  setCompactState: (sessionId: string, state: { active: boolean }) => void
  addToolEvent: (sessionId: string, event: ToolExecutionEvent) => void
  markStreaming: (sessionId: string, streaming: boolean) => void
  setError: (sessionId: string, error: { message: string; category: string; retrying: boolean; retryAttempt?: number; retryIn?: number } | null) => void
  clearSessionStreamState: (sessionId: string) => void
  finishSession: (sessionId: string) => void
  dismissFinished: (sessionId: string) => void
  updateUsage: (sessionId: string, usage: SessionStreamState['usage']) => void
  loadTasks: (sessionId: string) => Promise<void>
}

export interface ComposerDraft {
  text: string
  images: { data: string; mediaType: string }[]
}

const EMPTY_DRAFT: ComposerDraft = { text: '', images: [] }
const STREAM_FLUSH_MS = 32
type SessionStoreSet = (
  partial: Partial<SessionState> | ((state: SessionState) => Partial<SessionState>),
  replace?: false,
) => void

interface PendingStreamBuffer {
  streamingText: string
  thinkingText: string
  lastKind?: 'stream' | 'thinking'
  timer?: ReturnType<typeof setTimeout>
}

const pendingStreamBuffers = new Map<string, PendingStreamBuffer>()

function clearPendingStreamBuffer(sessionId: string) {
  const pending = pendingStreamBuffers.get(sessionId)
  if (pending?.timer) clearTimeout(pending.timer)
  pendingStreamBuffers.delete(sessionId)
}

function flushPendingStreamBuffer(
  sessionId: string,
  set: SessionStoreSet,
) {
  const pending = pendingStreamBuffers.get(sessionId)
  if (!pending || (!pending.streamingText && !pending.thinkingText)) return
  if (pending.timer) clearTimeout(pending.timer)
  pendingStreamBuffers.delete(sessionId)

  set((s) => {
    const current = s.sessionStates[sessionId] || EMPTY_STREAM_STATE
    const lastKind = pending.lastKind
    return {
      sessionStates: {
        ...s.sessionStates,
        [sessionId]: {
          ...current,
          streamingText: current.streamingText + pending.streamingText,
          thinkingText: current.thinkingText + pending.thinkingText,
          isThinking: lastKind === 'thinking' ? true : lastKind === 'stream' ? false : current.isThinking,
        },
      },
    }
  })
}

function queuePendingStreamText(
  sessionId: string,
  text: string,
  kind: 'stream' | 'thinking',
  set: SessionStoreSet,
) {
  if (!text) return
  const pending = pendingStreamBuffers.get(sessionId) || { streamingText: '', thinkingText: '' }
  if (kind === 'stream') pending.streamingText += text
  else pending.thinkingText += text
  pending.lastKind = kind
  if (!pending.timer) {
    pending.timer = setTimeout(() => flushPendingStreamBuffer(sessionId, set), STREAM_FLUSH_MS)
  }
  pendingStreamBuffers.set(sessionId, pending)
}

export const useSessionStore = create<SessionState>((set, get) => ({
  projects: [],
  activeSessionId: null,
  messages: [],
  isLoading: false,
  sessionStates: {},
  tasks: [],
  messageQueue: [],
  drafts: {},
  enqueueMessage: (text: string) => {
    set((s) => ({ messageQueue: [...s.messageQueue, text] }))
  },
  dequeueMessage: () => {
    const queue = get().messageQueue
    if (queue.length === 0) return undefined
    const [first, ...rest] = queue
    set({ messageQueue: rest })
    return first
  },
  removeFromQueue: (index: number) => {
    set((s) => ({ messageQueue: s.messageQueue.filter((_, i) => i !== index) }))
  },

  getDraft: (sessionId: string) => get().drafts[sessionId] ?? EMPTY_DRAFT,
  setDraftText: (sessionId: string, text: string) => {
    set((s) => {
      const current = s.drafts[sessionId] ?? EMPTY_DRAFT
      if (text.length === 0 && current.images.length === 0) {
        const { [sessionId]: _, ...rest } = s.drafts
        return { drafts: rest }
      }
      return { drafts: { ...s.drafts, [sessionId]: { ...current, text } } }
    })
  },
  setDraftImages: (sessionId: string, images: { data: string; mediaType: string }[]) => {
    set((s) => {
      const current = s.drafts[sessionId] ?? EMPTY_DRAFT
      if (images.length === 0 && current.text.length === 0) {
        const { [sessionId]: _, ...rest } = s.drafts
        return { drafts: rest }
      }
      return { drafts: { ...s.drafts, [sessionId]: { ...current, images } } }
    })
  },
  clearDraft: (sessionId: string) => {
    set((s) => {
      if (!s.drafts[sessionId]) return s
      const { [sessionId]: _, ...rest } = s.drafts
      return { drafts: rest }
    })
  },

  loadProjects: async () => {
    const projects = await ipc.session.list()
    set({ projects: projects || [] })
    // Auto-switch to first session if none active (triggers IDE discovery)
    const current = get().activeSessionId
    if (!current && projects?.length > 0) {
      const firstSession = projects[0].sessions?.[0]
      if (firstSession) get().switchSession(firstSession.id)
    }
  },

  createSession: async (cwd: string) => {
    const projectName = cwd.split('/').filter(Boolean).pop() || 'untitled'
    const { sessionId } = await ipc.session.create(projectName, cwd)
    const activeModelId = useModelStore.getState().activeModelId
    if (activeModelId) {
      ipc.session.setModel(sessionId, activeModelId)
    }
    useTeamStore.getState().reset()
    useBackgroundTaskStore.getState().reset()
    set({ activeSessionId: sessionId, messages: [] })
    await get().loadProjects()
  },

  switchSession: async (sessionId: string) => {
    set({ isLoading: true })
    // Clear IDE selection/atMentions from previous session
    useIdeStore.getState().setSelection(null)
    useIdeStore.getState().clearAtMentions()
    // Clear team / background-task state from previous session — both are session-scoped
    useTeamStore.getState().reset()
    useBackgroundTaskStore.getState().reset()
    const { messages, usage, modelId } = await ipc.session.switch(sessionId)
    if (modelId) {
      useModelStore.setState({ activeModelId: modelId })
    }
    set((s) => ({
      activeSessionId: sessionId,
      messages,
      isLoading: false,
      sessionStates: {
        ...s.sessionStates,
        ...(usage ? { [sessionId]: { ...(s.sessionStates[sessionId] || EMPTY_STREAM_STATE), usage } } : {}),
      },
    }))
    await get().loadTasks(sessionId)
  },

  deleteSession: async (sessionId: string) => {
    await ipc.session.delete(sessionId)
    if (get().activeSessionId === sessionId) {
      useTeamStore.getState().reset()
      useBackgroundTaskStore.getState().reset()
      set({ activeSessionId: null, messages: [] })
    }
    get().clearDraft(sessionId)
    await get().loadProjects()
  },

  renameSession: async (sessionId: string, title: string) => {
    await ipc.session.rename(sessionId, title)
    set((s) => ({
      projects: s.projects.map((p) => ({
        ...p,
        sessions: p.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, title } : sess
        ),
      })),
    }))
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
    queuePendingStreamText(sessionId, text, 'stream', set)
  },

  appendThinkingText: (sessionId: string, text: string) => {
    queuePendingStreamText(sessionId, text, 'thinking', set)
  },

  flushSessionStreamBuffers: (sessionId: string) => {
    flushPendingStreamBuffer(sessionId, set)
  },

  setCompactState: (sessionId: string, state: { active: boolean }) => {
    set((s) => {
      const current = s.sessionStates[sessionId] || EMPTY_STREAM_STATE
      return {
        sessionStates: {
          ...s.sessionStates,
          [sessionId]: { ...current, compacting: state.active },
        },
      }
    })
  },

  addToolEvent: (sessionId: string, event: ToolExecutionEvent) => {
    set((s) => {
      const current = s.sessionStates[sessionId] || EMPTY_STREAM_STATE
      const events = [...current.toolEvents]

      if (event.type === 'start') {
        events.push(event)
      } else {
        const idx = events.findIndex((e) => e.toolUseId === event.toolUseId)
        if (idx !== -1) {
          events[idx] = { ...events[idx], ...event }
        } else {
          events.push(event)
        }
      }

      return {
        sessionStates: {
          ...s.sessionStates,
          [sessionId]: { ...current, toolEvents: events },
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
    clearPendingStreamBuffer(sessionId)
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
    clearPendingStreamBuffer(sessionId)
    set((s) => {
      const current = s.sessionStates[sessionId] || EMPTY_STREAM_STATE
      return {
        sessionStates: {
          ...s.sessionStates,
          [sessionId]: { ...EMPTY_STREAM_STATE, finished: true, usage: current.usage, error: current.error },
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
