import { create } from 'zustand'

export interface TeamMemberUI {
  id: string
  name: string
  role: string
  agentType: string
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
  activeTeamId: string | null
  expandedMemberId: string | null

  setTeamStatus: (taskId: string, status: TeamStatusUI) => void
  setTeamEvents: (taskId: string, events: string[]) => void
  appendTeamEvent: (taskId: string, line: string) => void
  setActiveTeam: (id: string | null) => void
  setExpandedMember: (id: string | null) => void
  removeTeam: (id: string) => void
}

export const useTeamStore = create<TeamStoreState>((set) => ({
  teams: {},
  events: {},
  activeTeamId: null,
  expandedMemberId: null,

  setTeamStatus: (taskId, status) =>
    set((s) => ({ teams: { ...s.teams, [taskId]: status } })),

  setTeamEvents: (taskId, events) =>
    set((s) => ({ events: { ...s.events, [taskId]: events } })),

  appendTeamEvent: (taskId, line) =>
    set((s) => ({ events: { ...s.events, [taskId]: [...(s.events[taskId] || []), line] } })),

  setActiveTeam: (id) => set({ activeTeamId: id, expandedMemberId: null }),
  setExpandedMember: (id) => set({ expandedMemberId: id }),

  removeTeam: (taskId) =>
    set((s) => {
      const { [taskId]: _t, ...restTeams } = s.teams
      const { [taskId]: _e, ...restEvents } = s.events
      return {
        teams: restTeams,
        events: restEvents,
        activeTeamId: s.activeTeamId === taskId ? null : s.activeTeamId,
      }
    }),
}))
