import { v4 as uuid } from 'uuid'
import { TeamManager, type ManagerAction } from './team-manager.js'
import { TeamMember } from './team-member.js'
import { TeamConcurrencyController } from './team-concurrency.js'
import { RingBuffer } from './team-mailbox.js'
import {
  DEFAULT_CONCURRENCY_POLICY,
  type TeamStatus,
  type TeamMessage,
  type TeamEvent,
  type TeamMemberSpec,
  type TeamMemberState,
  type TeamConcurrencyPolicy,
  type TeamSharedContext,
  type Priority,
  type RiskLevel,
  type TeamMessageIntent,
} from './team-types.js'
import type { SubSessionOptions } from '../sub-session.js'

export interface TeamRuntimePlan {
  members: TeamMemberSpec[]
  tasks: Array<{
    title: string
    description: string
    priority?: Priority
    riskLevel?: RiskLevel
    dependsOn?: string[]
    suggestedRole?: string
  }>
}

export interface TeamRuntimeOptions {
  id?: string
  objective: string
  plan: TeamRuntimePlan
  subSessionDeps: Omit<SubSessionOptions, 'prompt' | 'agentType' | 'signal' | 'onAgentProgress' | 'onAgentText' | 'mailbox' | 'onToolEvent'>
  concurrency?: TeamConcurrencyPolicy
  onEvent?: (event: TeamEvent) => void
  onComplete?: (summary: string) => void
  onFail?: (error: string) => void
}

export class TeamRuntime {
  readonly id: string
  readonly objective: string

  private status: TeamStatus = 'planning'
  private manager: TeamManager
  private members: TeamMember[] = []
  private memberById = new Map<string, TeamMember>()
  private mailbox: TeamMessage[] = []
  private events: RingBuffer<TeamEvent>
  private concurrency: TeamConcurrencyController
  private sharedContext: TeamSharedContext
  private opts: TeamRuntimeOptions
  private tickScheduled = false
  private completed = false

  constructor(opts: TeamRuntimeOptions) {
    this.opts = opts
    this.id = opts.id ?? `team_${uuid().slice(0, 8)}`
    this.objective = opts.objective
    this.events = new RingBuffer<TeamEvent>(500)
    this.concurrency = new TeamConcurrencyController(opts.concurrency ?? DEFAULT_CONCURRENCY_POLICY)
    this.sharedContext = {
      objective: opts.objective,
      constraints: [],
      findings: [],
      decisions: [],
      artifacts: [],
      openQuestions: [],
      risks: [],
    }

    this.manager = new TeamManager({
      initialTasks: opts.plan.tasks,
      onEvent: (e) => this.recordEvent(e),
    })

    // Create members from plan (cap at 10)
    const memberSpecs = opts.plan.members.slice(0, 10)
    for (const spec of memberSpecs) {
      const count = spec.count ?? 1
      for (let i = 0; i < count; i++) {
        if (this.members.length >= 10) break
        const member = new TeamMember({
          spec,
          taskPrompt: '', // assigned later
          subSessionDeps: opts.subSessionDeps,
          onEvent: (e) => this.recordEvent(e),
          onComplete: (memberId, result) => this.handleMemberComplete(memberId, result),
          onFail: (memberId, error) => this.handleMemberFail(memberId, error),
        })
        this.members.push(member)
        this.memberById.set(member.id, member)
        this.recordEvent({ type: 'member_created', memberId: member.id, role: member.role, timestamp: Date.now() })
      }
    }
  }

  getStatus(): TeamStatus {
    return this.status
  }

  getId(): string {
    return this.id
  }

  getMembers(): TeamMemberState[] {
    return this.members.map(m => m.getState())
  }

  getEvents(tail?: number): TeamEvent[] {
    return tail ? this.events.tail(tail) : this.events.getAll()
  }

  getSharedContext(): TeamSharedContext {
    return JSON.parse(JSON.stringify(this.sharedContext))
  }

  getManagerState() {
    return this.manager.getState()
  }

  getTasks() {
    return this.manager.getTasks()
  }

  start(): void {
    this.status = 'running'
    this.recordEvent({ type: 'team_started', teamId: this.id, timestamp: Date.now() })
    this.scheduleTick()
  }

  /**
   * Send a message to the team (default: manager).
   * Used by main session / user / external interventions.
   */
  sendMessage(msg: TeamMessage): void {
    this.mailbox.push(msg)
    this.recordEvent({
      type: 'message_sent',
      from: msg.from + (msg.fromMemberId ? `:${msg.fromMemberId}` : ''),
      to: msg.to,
      intent: msg.intent,
      timestamp: Date.now(),
    })
    this.scheduleTick()
  }

  stop(): void {
    for (const member of this.members) {
      member.abort()
    }
    this.status = 'stopped'
  }

  private recordEvent(event: TeamEvent): void {
    this.events.push(event)
    this.opts.onEvent?.(event)
  }

  private scheduleTick(): void {
    if (this.tickScheduled || this.completed) return
    this.tickScheduled = true
    queueMicrotask(() => {
      this.tickScheduled = false
      this.tick()
    })
  }

  private tick(): void {
    if (this.completed) return

    // Drain mailbox and dispatch interventions
    const incoming = this.mailbox.splice(0)
    for (const msg of incoming) {
      const actions = this.manager.handleIntervention(msg)
      this.executeActions(actions)
    }

    // Get available members (not running, not failed/stopped)
    const availableIds: string[] = []
    for (const m of this.members) {
      const status = m.getStatus()
      if (status === 'queued') {
        if (this.concurrency.canStart(m.agentType)) {
          availableIds.push(m.id)
        }
      }
    }

    const activeCount = this.concurrency.getActiveCount()
    const actions = this.manager.decideTick(activeCount, availableIds)
    this.executeActions(actions)
  }

  private executeActions(actions: ManagerAction[]): void {
    for (const action of actions) {
      switch (action.type) {
        case 'assign_task':
          if (action.taskId && action.memberId) {
            this.assignTask(action.taskId, action.memberId)
          }
          break
        case 'send_member_message':
          if (action.memberId) {
            this.routeMessageToMember(action.memberId, action.message ?? '', action.intent)
          }
          break
        case 'broadcast':
          this.broadcast(action.message ?? '', action.intent)
          break
        case 'cancel_task':
          if (action.taskId) this.manager.cancelTask(action.taskId, 'manager decision')
          break
        case 'complete':
          this.completeTeam(action.summary ?? this.manager.synthesize())
          break
      }
    }
  }

  private assignTask(taskId: string, memberId: string): void {
    const task = this.manager.getTask(taskId)
    const member = this.memberById.get(memberId)
    if (!task || !member) return

    this.manager.markTaskAssigned(taskId, memberId)
    this.manager.markTaskRunning(taskId)
    this.concurrency.markRunning(memberId, member.agentType)

    const taskPrompt = `Task: ${task.title}\n\n${task.description}`
    // Build new member instance for this task, preserving ID and mailbox
    const taskMember = new TeamMember({
      spec: { role: member.role, agentType: member.agentType, modelId: member.modelId },
      taskPrompt,
      taskId,
      id: memberId,
      existingMailbox: member.getMailbox(),
      subSessionDeps: this.opts.subSessionDeps,
      onEvent: (e) => this.recordEvent(e),
      onComplete: (_mId, result) => {
        this.manager.markTaskCompleted(taskId, result)
        this.concurrency.markDone(memberId)
        this.scheduleTick()
      },
      onFail: (_mId, error) => {
        this.manager.markTaskFailed(taskId, error)
        this.concurrency.markDone(memberId)
        this.scheduleTick()
      },
    })
    // Replace in maps (same ID preserved)
    this.memberById.set(memberId, taskMember)
    const idx = this.members.findIndex(m => m.id === memberId)
    if (idx >= 0) this.members[idx] = taskMember

    taskMember.start().catch(() => {
      // failure handled in onFail
    })
  }

  private handleMemberComplete(_memberId: string, _result: any): void {
    // Already handled in assignTask's onComplete
  }

  private handleMemberFail(_memberId: string, _error: string): void {
    // Already handled in assignTask's onFail
  }

  private routeMessageToMember(memberId: string, content: string, intent?: string): void {
    const member = this.memberById.get(memberId)
    if (!member) return
    member.sendMessage({
      id: `msg_${uuid().slice(0, 6)}`,
      from: 'manager',
      to: `member:${memberId}`,
      intent: (intent as TeamMessageIntent) ?? 'message',
      content,
      priority: 'normal',
      createdAt: Date.now(),
    })
  }

  private broadcast(content: string, intent?: string): void {
    for (const member of this.members) {
      if (member.getStatus() === 'running') {
        member.sendMessage({
          id: `msg_${uuid().slice(0, 6)}`,
          from: 'manager',
          to: `member:${member.id}`,
          intent: (intent as TeamMessageIntent) ?? 'message',
          content,
          priority: intent === 'wrap_up' || intent === 'hurry' ? 'high' : 'normal',
          createdAt: Date.now(),
        })
      }
    }
  }

  private completeTeam(summary: string): void {
    if (this.completed) return
    this.completed = true
    this.status = 'completed'
    this.recordEvent({ type: 'team_synthesizing', timestamp: Date.now() })
    this.recordEvent({ type: 'team_completed', summary, timestamp: Date.now() })
    this.opts.onComplete?.(summary)
  }
}
