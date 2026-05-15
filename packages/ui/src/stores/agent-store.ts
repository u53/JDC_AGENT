import { create } from 'zustand'

export interface AgentToolEvent {
  toolName: string
  status: 'start' | 'complete' | 'error'
  input?: Record<string, unknown>
  result?: { content: string; isError?: boolean }
}

export interface AgentState {
  agentToolUseId: string
  prompt: string
  modelId?: string
  status: 'running' | 'done' | 'error'
  toolEvents: AgentToolEvent[]
  textOutput: string
  toolCount: number
  startTime: number
  result?: string
}

interface AgentStoreState {
  agents: Record<string, AgentState>
  activeAgentId: string | null
  addAgent: (id: string, prompt: string, modelId?: string) => void
  updateAgentTool: (id: string, toolName: string, toolStatus: 'start' | 'complete' | 'error', toolInput?: Record<string, unknown>, toolResult?: { content: string; isError?: boolean }, toolCount?: number) => void
  appendAgentText: (id: string, text: string) => void
  completeAgent: (id: string, result: string) => void
  errorAgent: (id: string) => void
  setActiveAgent: (id: string | null) => void
  removeAgent: (id: string) => void
}

export const useAgentStore = create<AgentStoreState>((set) => ({
  agents: {},
  activeAgentId: null,

  addAgent: (id, prompt, modelId) => set((s) => ({
    agents: {
      ...s.agents,
      [id]: { agentToolUseId: id, prompt, modelId, status: 'running', toolEvents: [], textOutput: '', toolCount: 0, startTime: Date.now() },
    },
  })),

  updateAgentTool: (id, toolName, toolStatus, toolInput, toolResult, toolCount) => set((s) => {
    const agent = s.agents[id]
    if (!agent) return s
    const newEvents = [...agent.toolEvents]
    if (toolStatus === 'start') {
      newEvents.push({ toolName, status: 'start', input: toolInput })
    } else {
      const last = [...newEvents].reverse().find(e => e.toolName === toolName && e.status === 'start')
      if (last) {
        last.status = toolStatus
        last.result = toolResult
      } else {
        newEvents.push({ toolName, status: toolStatus, input: toolInput, result: toolResult })
      }
    }
    return {
      agents: {
        ...s.agents,
        [id]: { ...agent, toolEvents: newEvents, toolCount: toolCount ?? agent.toolCount },
      },
    }
  }),

  appendAgentText: (id, text) => set((s) => {
    const agent = s.agents[id]
    if (!agent) return s
    return {
      agents: { ...s.agents, [id]: { ...agent, textOutput: agent.textOutput + text } },
    }
  }),

  completeAgent: (id, result) => set((s) => {
    const agent = s.agents[id]
    if (!agent) return s
    return {
      agents: { ...s.agents, [id]: { ...agent, status: 'done', result } },
    }
  }),

  errorAgent: (id) => set((s) => {
    const agent = s.agents[id]
    if (!agent) return s
    return {
      agents: { ...s.agents, [id]: { ...agent, status: 'error' } },
    }
  }),

  setActiveAgent: (id) => set({ activeAgentId: id }),

  removeAgent: (id) => set((s) => {
    const { [id]: _, ...rest } = s.agents
    return { agents: rest, activeAgentId: s.activeAgentId === id ? null : s.activeAgentId }
  }),
}))
