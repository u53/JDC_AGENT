export type PolicyEventPhase = 'pre_tool_use' | 'post_tool_use'
export type PolicyEventDecision = 'allow' | 'block' | 'record'
export type PolicyEventSource = 'FileMutationPolicy' | 'ToolResultMetadata' | 'VerificationLedger'

export interface PolicyEvent {
  id: string
  phase: PolicyEventPhase
  source: PolicyEventSource
  decision: PolicyEventDecision
  toolName: string
  toolUseId: string
  cwd: string
  reason?: string
  createdAt: number
}

export interface PolicyEventInput {
  phase: PolicyEventPhase
  source: PolicyEventSource
  decision: PolicyEventDecision
  toolName: string
  toolUseId?: string
  cwd: string
  reason?: string
}

export class PolicyEventLedger {
  private events: PolicyEvent[] = []
  private sequence = 0
  private maxEvents: number
  private now: () => number

  constructor(options: { maxEvents?: number; now?: () => number } = {}) {
    this.maxEvents = options.maxEvents ?? 200
    this.now = options.now ?? Date.now
  }

  record(input: PolicyEventInput): PolicyEvent {
    this.sequence += 1
    const createdAt = this.now()
    const event: PolicyEvent = {
      id: `policy_${createdAt}_${this.sequence}`,
      phase: input.phase,
      source: input.source,
      decision: input.decision,
      toolName: input.toolName,
      toolUseId: input.toolUseId ?? '',
      cwd: input.cwd,
      reason: input.reason,
      createdAt,
    }
    this.events.push(event)
    while (this.events.length > this.maxEvents) this.events.shift()
    return event
  }

  list(): PolicyEvent[] {
    return [...this.events]
  }

  clear(): void {
    this.events = []
  }
}
