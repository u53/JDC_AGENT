import { create } from 'zustand'

export interface TeamMemberUI {
  id: string
  name: string
  role: string
  responsibility?: string
  expertPrompt?: string
  agentType: string
  modelId?: string
  status: string
  currentTaskId?: string
  toolCount: number
  lastActivityAt: number
}

export interface TeamTaskUI {
  id: string
  title: string
  description: string
  status: string
  assigneeId?: string
  priority: string
}

export interface TeamConversationEntry {
  id: string
  direction: 'sent' | 'received'
  from: string
  intent: string
  content: string
  timestamp: number
  status?: 'sending' | 'delivered' | 'failed'
}

export interface TeamStatusUI {
  type: 'team'
  id: string
  objective: string
  status: string
  manager: { id: string; name: string; status: string; currentDecision?: string }
  members: TeamMemberUI[]
  tasks: TeamTaskUI[]
  taskStats: { total: number; completed: number; running: number; blocked: number; cancelled: number; todo: number; failed: number }
  finished?: boolean
}

interface TeamStoreState {
  teams: Record<string, TeamStatusUI>
  events: Record<string, string[]>
  conversations: Record<string, TeamConversationEntry[]>
  conversationKeys: Record<string, Set<string>>
  activeTeamId: string | null
  expandedMemberId: string | null

  setTeamStatus: (taskId: string, status: TeamStatusUI) => void
  setTeamEvents: (taskId: string, events: string[]) => void
  appendTeamEvent: (taskId: string, line: string) => void
  appendConversation: (taskId: string, entry: TeamConversationEntry) => void
  updateConversation: (taskId: string, id: string, patch: Partial<TeamConversationEntry>) => void
  appendConversationIfNew: (taskId: string, entry: TeamConversationEntry, dedupKey: string) => boolean
  setActiveTeam: (id: string | null) => void
  setExpandedMember: (id: string | null) => void
  reset: () => void
  removeTeam: (id: string) => void
}

export const useTeamStore = create<TeamStoreState>((set, get) => ({
  teams: {},
  events: {},
  conversations: {},
  conversationKeys: {},
  activeTeamId: null,
  expandedMemberId: null,

  setTeamStatus: (taskId, status) =>
    set((s) => ({ teams: { ...s.teams, [taskId]: status } })),

  setTeamEvents: (taskId, events) =>
    set((s) => ({ events: { ...s.events, [taskId]: events } })),

  appendTeamEvent: (taskId, line) =>
    set((s) => ({ events: { ...s.events, [taskId]: [...(s.events[taskId] || []), line] } })),

  appendConversation: (taskId, entry) =>
    set((s) => ({
      conversations: {
        ...s.conversations,
        [taskId]: [...(s.conversations[taskId] || []), entry],
      },
    })),

  updateConversation: (taskId, id, patch) =>
    set((s) => {
      const list = s.conversations[taskId] || []
      const updated = list.map(e => e.id === id ? { ...e, ...patch } : e)
      return { conversations: { ...s.conversations, [taskId]: updated } }
    }),

  appendConversationIfNew: (taskId, entry, dedupKey) => {
    const state = get()
    const keys = state.conversationKeys[taskId] || new Set<string>()
    if (keys.has(dedupKey)) return false
    const newKeys = new Set(keys)
    newKeys.add(dedupKey)
    set((s) => ({
      conversations: {
        ...s.conversations,
        [taskId]: [...(s.conversations[taskId] || []), entry],
      },
      conversationKeys: { ...s.conversationKeys, [taskId]: newKeys },
    }))
    return true
  },

  setActiveTeam: (id) => set({ activeTeamId: id, expandedMemberId: null }),
  setExpandedMember: (id) => set({ expandedMemberId: id }),

  reset: () =>
    set({
      teams: {},
      events: {},
      conversations: {},
      conversationKeys: {},
      activeTeamId: null,
      expandedMemberId: null,
    }),

  removeTeam: (taskId) =>
    set((s) => {
      const { [taskId]: _t, ...restTeams } = s.teams
      const { [taskId]: _e, ...restEvents } = s.events
      const { [taskId]: _c, ...restConv } = s.conversations
      const { [taskId]: _k, ...restKeys } = s.conversationKeys
      return {
        teams: restTeams,
        events: restEvents,
        conversations: restConv,
        conversationKeys: restKeys,
        activeTeamId: s.activeTeamId === taskId ? null : s.activeTeamId,
      }
    }),
}))
