import { v4 as uuid } from 'uuid'
import type {
  TeamTask,
  TeamTaskResult,
  TeamMessage,
  TeamEvent,
  TeamManagerState,
  Priority,
  RiskLevel,
} from './team-types.js'

export interface ManagerAction {
  type: 'assign_task' | 'cancel_task' | 'send_member_message' | 'request_member_status' | 'broadcast' | 'add_constraint' | 'wrap_up' | 'complete' | 'reply' | 'escalate_to_user' | 'add_member' | 'remove_member' | 'add_task' | 'reopen_task' | 'kick_member'
  taskId?: string
  memberId?: string
  message?: string
  intent?: string
  constraint?: string
  summary?: string
  spec?: { role: string; responsibility?: string; agentType?: string; modelId?: string }
  force?: boolean
  taskInput?: { title: string; description: string; priority?: Priority; dependsOn?: string[] }
  /**
   * Runtime-only marker (not part of the JSON protocol). Set when the action
   * was produced by a proactive PM trigger (task_completed, task_added, idle
   * timeout, staffing follow-up) rather than by a direct user/main_session
   * intervention. The runtime uses this to decide whether a 'reply' action
   * should wake the main session or stay internal.
   */
  _proactive?: boolean
}

export interface TeamManagerOptions {
  managerId?: string
  initialTasks: Array<{
    title: string
    description: string
    priority?: Priority
    riskLevel?: RiskLevel
    dependsOn?: string[]
    suggestedRole?: string
  }>
  onEvent?: (event: TeamEvent) => void
}

export class TeamManager {
  readonly id: string
  private status: TeamManagerState['status'] = 'planning'
  private currentDecision?: string
  private lastActivityAt: number = Date.now()

  protected tasks = new Map<string, TeamTask>()
  private titleToId = new Map<string, string>()
  private constraints: string[] = []
  protected wrapUpRequested = false

  constructor(protected opts: TeamManagerOptions) {
    this.id = opts.managerId ?? `pm_${uuid().slice(0, 8)}`
    for (const t of opts.initialTasks) {
      const title = typeof t.title === 'string' && t.title.trim().length > 0
        ? t.title.trim()
        : '(untitled task)'
      const description = typeof t.description === 'string' ? t.description : ''
      const task: TeamTask = {
        id: `task_${uuid().slice(0, 6)}`,
        title,
        description,
        status: 'todo',
        priority: t.priority ?? 'normal',
        riskLevel: t.riskLevel ?? 'low',
        dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.filter(d => typeof d === 'string' && d.length > 0) : undefined,
        createdBy: 'manager',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      this.tasks.set(task.id, task)
      this.titleToId.set(task.title.toLowerCase(), task.id)
      this.opts.onEvent?.({ type: 'task_created', taskId: task.id, title: task.title, timestamp: Date.now() })
    }
    // Resolve dependsOn references (support both ID and title)
    for (const task of this.tasks.values()) {
      if (task.dependsOn) {
        task.dependsOn = task.dependsOn.map(dep => this.resolveTaskRef(dep))
      }
    }
  }

  getState(): TeamManagerState {
    return {
      id: this.id,
      role: 'project-manager',
      name: 'Project Manager',
      status: this.status,
      currentDecision: this.currentDecision,
      lastActivityAt: this.lastActivityAt,
    }
  }

  setStatus(status: TeamManagerState['status']): void {
    this.status = status
    this.lastActivityAt = Date.now()
  }

  getTasks(): TeamTask[] {
    return [...this.tasks.values()]
  }

  getTask(taskId: string): TeamTask | undefined {
    return this.tasks.get(taskId)
  }

  getRunnableTasks(): TeamTask[] {
    return [...this.tasks.values()].filter(t => {
      if (t.status !== 'todo' && t.status !== 'reopened') return false
      if (!t.dependsOn || t.dependsOn.length === 0) return true
      return t.dependsOn.every(depRef => {
        const depId = this.resolveTaskRef(depRef)
        const dep = this.tasks.get(depId)
        return dep?.status === 'completed'
      })
    })
  }

  private resolveTaskRef(ref: string): string {
    if (typeof ref !== 'string' || ref.length === 0) return ''
    if (this.tasks.has(ref)) return ref
    const byTitle = this.titleToId.get(ref.toLowerCase())
    if (byTitle) return byTitle
    return ref
  }

  markTaskAssigned(taskId: string, memberId: string): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.status = 'assigned'
    task.assigneeId = memberId
    task.updatedAt = Date.now()
    this.lastActivityAt = Date.now()
    this.opts.onEvent?.({ type: 'task_assigned', taskId, memberId, timestamp: Date.now() })
  }

  markTaskRunning(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.status = 'running'
    task.updatedAt = Date.now()
  }

  markTaskCompleted(taskId: string, result: TeamTaskResult): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.status = 'completed'
    task.result = result
    task.updatedAt = Date.now()
    this.lastActivityAt = Date.now()
    this.opts.onEvent?.({
      type: 'task_completed',
      taskId,
      memberId: task.assigneeId ?? 'unknown',
      timestamp: Date.now(),
    })
  }

  markTaskFailed(taskId: string, error: string): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.status = 'failed'
    task.updatedAt = Date.now()
    task.lastError = error
    task.failureCount = (task.failureCount ?? 0) + 1
    this.opts.onEvent?.({
      type: 'task_failed',
      taskId,
      error,
      failureCount: task.failureCount,
      timestamp: Date.now(),
    })
  }

  addTask(opts: { title: string; description: string; priority?: Priority; riskLevel?: RiskLevel; dependsOn?: string[] }): string {
    const title = typeof opts.title === 'string' && opts.title.trim().length > 0
      ? opts.title.trim()
      : '(untitled task)'
    const description = typeof opts.description === 'string' ? opts.description : ''
    const rawDeps = Array.isArray(opts.dependsOn)
      ? opts.dependsOn.filter(d => typeof d === 'string' && d.length > 0)
      : []
    // Resolve deps: title → ID. Drop unresolvable refs (PM used a bad reference)
    // so the task doesn't get permanently blocked.
    const deps: string[] = []
    for (const dep of rawDeps) {
      const resolved = this.resolveTaskRef(dep)
      if (this.tasks.has(resolved)) {
        deps.push(resolved)
      } else {
        this.opts.onEvent?.({
          type: 'manager_decision',
          text: `Warning: dependsOn "${dep}" in task "${title}" could not be resolved — dropping this dependency`,
          timestamp: Date.now(),
        })
      }
    }
    const task: TeamTask = {
      id: `task_${uuid().slice(0, 6)}`,
      title,
      description,
      status: 'todo',
      priority: opts.priority ?? 'normal',
      riskLevel: opts.riskLevel ?? 'low',
      dependsOn: deps.length > 0 ? deps : undefined,
      createdBy: 'manager',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.tasks.set(task.id, task)
    this.titleToId.set(task.title.toLowerCase(), task.id)
    this.opts.onEvent?.({ type: 'task_created', taskId: task.id, title: task.title, timestamp: Date.now() })
    return task.id
  }

  cancelTask(taskId: string, reason: string): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    if (task.status === 'completed' || task.status === 'failed') return
    task.status = 'cancelled'
    task.updatedAt = Date.now()
    this.opts.onEvent?.({ type: 'task_cancelled', taskId, reason, timestamp: Date.now() })
  }

  /**
   * Reopen a completed/failed task — used when QA finds issues that require rework.
   * Resets status to 'reopened' and clears assignee so the runtime can re-assign.
   */
  reopenTask(taskId: string, reason?: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false
    if ((task.failureCount ?? 0) >= 3) {
      this.cancelTask(taskId, `Auto-cancelled: exceeded max failure count (${task.failureCount})`)
      return false
    }
    task.status = 'reopened'
    task.assigneeId = undefined
    task.updatedAt = Date.now()
    this.opts.onEvent?.({
      type: 'manager_decision',
      text: `Reopened task ${taskId}${reason ? `: ${reason}` : ''}`,
      timestamp: Date.now(),
    })
    return true
  }

  addConstraint(constraint: string): void {
    this.constraints.push(constraint)
    this.lastActivityAt = Date.now()
  }

  getConstraints(): string[] {
    return [...this.constraints]
  }

  requestWrapUp(): void {
    this.wrapUpRequested = true
    this.lastActivityAt = Date.now()
    // Cancel non-running todo tasks
    for (const task of this.tasks.values()) {
      if (task.status === 'todo' && task.priority !== 'urgent') {
        this.cancelTask(task.id, 'wrap_up requested')
      }
    }
  }

  isWrapUpRequested(): boolean {
    return this.wrapUpRequested
  }

  /**
   * Determine what manager actions to take given current state.
   * Called by TeamRuntime on each tick.
   */
  decideTick(activeMemberCount: number, availableMemberIds: string[]): ManagerAction[] {
    const actions: ManagerAction[] = []
    this.lastActivityAt = Date.now()

    // Check if all tasks are done -> complete
    const allTasks = [...this.tasks.values()]
    const terminalStates = new Set(['completed', 'failed', 'cancelled'])
    const allDone = allTasks.length > 0 && allTasks.every(t => terminalStates.has(t.status))
    if (allDone) {
      this.status = 'synthesizing'
      actions.push({ type: 'complete', summary: this.synthesize() })
      return actions
    }

    // If wrap-up requested and no running tasks, finalize
    const runningCount = allTasks.filter(t => t.status === 'running' || t.status === 'assigned').length
    if (this.wrapUpRequested && runningCount === 0) {
      this.status = 'synthesizing'
      actions.push({ type: 'complete', summary: this.synthesize() })
      return actions
    }

    // Try to assign runnable tasks
    if (!this.wrapUpRequested) {
      const runnable = this.getRunnableTasks()
      // Sort by priority: urgent > high > normal > low
      const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 }
      runnable.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

      let availableIdx = 0
      for (const task of runnable) {
        if (availableIdx >= availableMemberIds.length) break
        const memberId = availableMemberIds[availableIdx++]
        actions.push({ type: 'assign_task', taskId: task.id, memberId })
      }
    }

    this.status = actions.length > 0 ? 'assigning' : 'waiting_for_members'
    return actions
  }

  /**
   * Handle an incoming intervention message.
   */
  handleIntervention(msg: TeamMessage): ManagerAction[] {
    this.status = 'handling_intervention'
    this.lastActivityAt = Date.now()
    const actions: ManagerAction[] = []

    this.opts.onEvent?.({
      type: 'intervention_received',
      from: msg.from === 'main_session' ? 'main_session' : 'user',
      intent: msg.intent,
      timestamp: Date.now(),
    })

    switch (msg.intent) {
      case 'wrap_up':
        this.requestWrapUp()
        actions.push({ type: 'broadcast', message: msg.content || 'Wrap up: stop new work, finalize current findings.', intent: 'wrap_up' })
        break
      case 'hurry':
        actions.push({ type: 'broadcast', message: msg.content || 'Hurry: focus on essentials, no new exploration.', intent: 'hurry' })
        break
      case 'request_status':
        actions.push({ type: 'broadcast', message: 'Please report concise status.', intent: 'request_status' })
        break
      case 'narrow_scope':
      case 'reprioritize':
        if (msg.content) this.addConstraint(msg.content)
        actions.push({ type: 'broadcast', message: msg.content, intent: msg.intent })
        break
      case 'assign':
      case 'schedule':
        // Trigger immediate task assignment for available members
        actions.push(...this.forceAssign(msg.content))
        break
      case 'message':
      default:
        // Direct message: forward
        if (msg.to.startsWith('member:')) {
          actions.push({
            type: 'send_member_message',
            memberId: msg.to.slice('member:'.length),
            message: msg.content,
            intent: msg.intent,
          })
        } else {
          actions.push({ type: 'broadcast', message: msg.content, intent: msg.intent })
        }
        break
    }

    // Emit a manager_decision event so main session knows PM responded
    const actionSummary = actions.map(a => `${a.type}${a.intent ? `(${a.intent})` : ''}`).join(', ')
    this.opts.onEvent?.({
      type: 'manager_decision',
      text: `Received "${msg.intent}" from ${msg.from}. Actions: ${actionSummary}`,
      timestamp: Date.now(),
    })

    return actions
  }

  /**
   * Force-assign runnable tasks to available members.
   * Called when user sends 'assign' or 'schedule' intent.
   * Resets failed tasks to 'todo' so they can be re-assigned by decideTick.
   */
  private forceAssign(_hint?: string): ManagerAction[] {
    const actions: ManagerAction[] = []
    // Reset failed tasks back to todo so they can be retried
    for (const task of this.tasks.values()) {
      if (task.status === 'failed') {
        task.status = 'todo'
        task.assigneeId = undefined
        task.updatedAt = Date.now()
      }
    }
    const runnable = this.getRunnableTasks()
    if (runnable.length === 0) {
      this.opts.onEvent?.({
        type: 'manager_decision',
        text: 'No runnable tasks available to assign (all tasks are completed, running, or blocked by dependencies).',
        timestamp: Date.now(),
      })
    } else {
      this.opts.onEvent?.({
        type: 'manager_decision',
        text: `Force-schedule triggered: ${runnable.length} task(s) ready for assignment.`,
        timestamp: Date.now(),
      })
    }
    return actions
  }

  /**
   * Build a final synthesis from completed tasks.
   */
  synthesize(): string {
    const completed = [...this.tasks.values()].filter(t => t.status === 'completed')
    const failed = [...this.tasks.values()].filter(t => t.status === 'failed')
    const cancelled = [...this.tasks.values()].filter(t => t.status === 'cancelled')

    const lines: string[] = []
    lines.push(`# Team Synthesis`)
    lines.push('')
    lines.push(`Tasks completed: ${completed.length}`)
    if (failed.length) lines.push(`Tasks failed: ${failed.length}`)
    if (cancelled.length) lines.push(`Tasks cancelled: ${cancelled.length}`)
    lines.push('')

    if (this.constraints.length > 0) {
      lines.push(`## Constraints`)
      this.constraints.forEach(c => lines.push(`- ${c}`))
      lines.push('')
    }

    lines.push(`## Results`)
    for (const task of completed) {
      lines.push(`### ${task.title}`)
      lines.push(task.result?.summary ?? '(no summary)')
      lines.push('')
    }

    if (failed.length > 0) {
      lines.push(`## Failed Tasks`)
      for (const task of failed) {
        lines.push(`- ${task.title}`)
      }
    }

    this.status = 'completed'
    return lines.join('\n')
  }
}
