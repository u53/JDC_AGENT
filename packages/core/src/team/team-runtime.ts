import { v4 as uuid } from 'uuid'
import { TeamManager, type ManagerAction } from './team-manager.js'
import { TeamManagerAI, type TeamManagerAIOptions } from './team-manager-ai.js'
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
import type { ModelProvider } from '../model-provider.js'
import type { ModelConfig } from '../types.js'

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
  taskTimeoutMs?: number
  teamTimeoutMs?: number
  aiPM?: { provider: ModelProvider; modelConfig: ModelConfig }
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
  private taskTimeouts = new Map<string, NodeJS.Timeout>()
  private teamTimeout?: NodeJS.Timeout

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

    // Upgrade to AI PM if provider is available
    if (opts.aiPM) {
      const aiManager = new TeamManagerAI({
        initialTasks: opts.plan.tasks,
        onEvent: (e) => this.recordEvent(e),
        provider: opts.aiPM.provider,
        modelConfig: opts.aiPM.modelConfig,
        memberStates: () => this.getMembers(),
        objective: opts.objective,
        onActionsReady: () => this.scheduleTick(),
      })
      this.manager = aiManager
    }

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

  addTask(task: { title: string; description: string; priority?: Priority; dependsOn?: string[] }): void {
    this.manager.addTask(task)
    this.triggerProactive('task_added')
    this.scheduleTick()
  }

  /**
   * Trigger AI PM to proactively re-evaluate team state.
   * No-op if PM isn't AI-powered. Throttled internally by TeamManagerAI.
   */
  private triggerProactive(reason: string): void {
    if ('triggerProactiveCheck' in this.manager && typeof (this.manager as any).triggerProactiveCheck === 'function') {
      (this.manager as TeamManagerAI).triggerProactiveCheck(reason)
    }
  }

  /**
   * Dynamically add a new worker (up to 10-cap).
   * Returns the new memberId, or null if capped or completed.
   */
  addMember(spec: TeamMemberSpec, reason?: string): string | null {
    if (this.completed) return null
    if (this.members.length >= 10) {
      this.recordEvent({
        type: 'manager_decision',
        text: `Cannot add member: team is at the 10-worker cap.`,
        timestamp: Date.now(),
      })
      return null
    }
    const member = new TeamMember({
      spec,
      taskPrompt: '',
      subSessionDeps: this.opts.subSessionDeps,
      onEvent: (e) => this.recordEvent(e),
      onComplete: (memberId, result) => this.handleMemberComplete(memberId, result),
      onFail: (memberId, error) => this.handleMemberFail(memberId, error),
    })
    this.members.push(member)
    this.memberById.set(member.id, member)
    this.recordEvent({
      type: 'member_added',
      memberId: member.id,
      role: member.role,
      agentType: member.agentType,
      reason,
      timestamp: Date.now(),
    })
    // Notify AI PM so it can assign tasks intelligently (instead of base round-robin)
    if ('notifyStaffingChange' in this.manager) {
      (this.manager as TeamManagerAI).notifyStaffingChange('added', member.id, member.role, member.agentType)
    }
    this.scheduleTick()
    return member.id
  }

  /**
   * Dynamically remove a worker.
   * Default: only removes 'queued' members. force=true also removes running ones (aborts them).
   */
  removeMember(memberId: string, opts: { force?: boolean; reason?: string } = {}): boolean {
    const member = this.memberById.get(memberId)
    if (!member) return false
    const status = member.getStatus()
    if (status === 'running' && !opts.force) {
      this.recordEvent({
        type: 'manager_decision',
        text: `Cannot remove ${member.role} (${memberId}): currently running. Use force=true to abort.`,
        timestamp: Date.now(),
      })
      return false
    }
    if (status === 'running') {
      member.abort()
    }
    this.memberById.delete(memberId)
    const idx = this.members.findIndex(m => m.id === memberId)
    if (idx >= 0) this.members.splice(idx, 1)
    this.concurrency.markDone(memberId)
    this.recordEvent({
      type: 'member_removed',
      memberId,
      role: member.role,
      reason: opts.reason,
      timestamp: Date.now(),
    })
    if ('notifyStaffingChange' in this.manager) {
      (this.manager as TeamManagerAI).notifyStaffingChange('removed', memberId, member.role)
    }
    this.scheduleTick()
    return true
  }

  start(): void {
    this.status = 'running'
    this.recordEvent({ type: 'team_started', teamId: this.id, timestamp: Date.now() })

    // Team-level timeout (default: 30 minutes)
    const teamTimeoutMs = this.opts.teamTimeoutMs ?? 30 * 60 * 1000
    this.teamTimeout = setTimeout(() => {
      if (!this.completed) {
        this.recordEvent({ type: 'team_failed', error: `Team timed out after ${teamTimeoutMs / 1000}s`, timestamp: Date.now() })
        this.stop()
        this.opts.onFail?.(`Team timed out after ${teamTimeoutMs / 1000}s`)
      }
    }, teamTimeoutMs)

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
    if (this.teamTimeout) clearTimeout(this.teamTimeout)
    for (const [, timeout] of this.taskTimeouts) clearTimeout(timeout)
    this.taskTimeouts.clear()
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

    // Consume any pending AI PM actions
    if ('consumeAIActions' in this.manager) {
      const aiActions = (this.manager as TeamManagerAI).consumeAIActions()
      if (aiActions.length > 0) {
        this.executeActions(aiActions)
      }
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

    // Check idle workers — if any have been queued > 30s with no work to give them,
    // ask AI PM whether to remove or whether the team needs more capacity elsewhere.
    const now = Date.now()
    const IDLE_THRESHOLD_MS = 30_000
    const hasIdleStale = this.members.some(
      m => m.getStatus() === 'queued' && (now - m.getState().lastActivityAt) > IDLE_THRESHOLD_MS
    )
    if (hasIdleStale) {
      this.triggerProactive('worker_idle_timeout')
    }
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
        case 'reply':
          if (action.message) {
            this.recordEvent({ type: 'manager_reply', text: action.message, timestamp: Date.now() })
          }
          break
        case 'add_member':
          if (action.spec) {
            this.addMember(action.spec, action.message)
          }
          break
        case 'remove_member':
          if (action.memberId) {
            this.removeMember(action.memberId, { force: action.force, reason: action.message })
          }
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
    const memberSpec = { role: member.role, agentType: member.agentType, modelId: member.modelId }
    // Build new member instance for this task, preserving ID and mailbox
    const taskMember = new TeamMember({
      spec: memberSpec,
      taskPrompt,
      taskId,
      id: memberId,
      existingMailbox: member.getMailbox(),
      teamMailbox: { push: (msg: any) => this.sendMessage(msg) },
      subSessionDeps: this.opts.subSessionDeps,
      onEvent: (e) => this.recordEvent(e),
      onComplete: (_mId, result) => {
        this.clearTaskTimeout(taskId)
        this.manager.markTaskCompleted(taskId, result)
        this.concurrency.markDone(memberId)
        this.recycleMember(memberId, memberSpec)
        this.triggerProactive('task_completed')
        this.scheduleTick()
      },
      onFail: (_mId, error) => {
        this.clearTaskTimeout(taskId)
        this.manager.markTaskFailed(taskId, error)
        this.concurrency.markDone(memberId)
        this.recycleMember(memberId, memberSpec)
        this.triggerProactive('task_failed')
        this.scheduleTick()
      },
    })
    // Replace in maps (same ID preserved)
    this.memberById.set(memberId, taskMember)
    const idx = this.members.findIndex(m => m.id === memberId)
    if (idx >= 0) this.members[idx] = taskMember

    // Start task timeout (default: 10 minutes per task)
    const taskTimeoutMs = this.opts.taskTimeoutMs ?? 10 * 60 * 1000
    const timeout = setTimeout(() => {
      if (taskMember.getStatus() === 'running') {
        taskMember.abort()
        this.manager.markTaskFailed(taskId, `Task timed out after ${taskTimeoutMs / 1000}s`)
        this.concurrency.markDone(memberId)
        this.recycleMember(memberId, memberSpec)
        this.recordEvent({ type: 'task_cancelled', taskId, reason: 'timeout', timestamp: Date.now() })
        this.scheduleTick()
      }
    }, taskTimeoutMs)
    this.taskTimeouts.set(taskId, timeout)

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

  private clearTaskTimeout(taskId: string): void {
    const timeout = this.taskTimeouts.get(taskId)
    if (timeout) {
      clearTimeout(timeout)
      this.taskTimeouts.delete(taskId)
    }
  }

  private recycleMember(memberId: string, originalSpec: { role: string; agentType: string; modelId?: string }): void {
    if (this.completed) return
    // If no remaining work, don't recycle — the team is about to complete
    // and we'd just leave a ghost queued member behind.
    const tasks = this.manager.getTasks()
    const hasMoreWork = tasks.some(t =>
      t.status === 'todo' || t.status === 'assigned' || t.status === 'running'
    )
    if (!hasMoreWork) {
      // Drop the member entirely so the UI doesn't show a confusing queued-but-team-finished state
      this.memberById.delete(memberId)
      const idx = this.members.findIndex(m => m.id === memberId)
      if (idx >= 0) this.members.splice(idx, 1)
      return
    }
    const freshMember = new TeamMember({
      spec: { role: originalSpec.role, agentType: originalSpec.agentType, modelId: originalSpec.modelId },
      taskPrompt: '',
      id: memberId,
      subSessionDeps: this.opts.subSessionDeps,
      onEvent: (e) => this.recordEvent(e),
      onComplete: (mId, result) => this.handleMemberComplete(mId, result),
      onFail: (mId, error) => this.handleMemberFail(mId, error),
    })
    this.memberById.set(memberId, freshMember)
    const idx = this.members.findIndex(m => m.id === memberId)
    if (idx >= 0) this.members[idx] = freshMember
    this.recordEvent({ type: 'member_created', memberId, role: originalSpec.role, timestamp: Date.now() })
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
    if (this.teamTimeout) clearTimeout(this.teamTimeout)
    for (const [, timeout] of this.taskTimeouts) clearTimeout(timeout)
    this.taskTimeouts.clear()
    this.status = 'completed'
    this.recordEvent({ type: 'team_synthesizing', timestamp: Date.now() })
    this.recordEvent({ type: 'team_completed', summary, timestamp: Date.now() })
    this.opts.onComplete?.(summary)
  }
}
