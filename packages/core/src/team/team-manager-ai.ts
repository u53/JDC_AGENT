import { v4 as uuid } from 'uuid'
import { TeamManager, type ManagerAction, type TeamManagerOptions } from './team-manager.js'
import type { TeamMessage, TeamEvent, TeamMemberState, TeamTask } from './team-types.js'
import type { ModelProvider } from '../model-provider.js'
import type { ModelConfig, Message, ContentBlock } from '../types.js'

export interface TeamManagerAIOptions extends TeamManagerOptions {
  provider: ModelProvider
  modelConfig: ModelConfig
  memberStates: () => TeamMemberState[]
  objective: string
  /**
   * Called when AI produces new actions ready to be consumed.
   * TeamRuntime should schedule a tick in response so pendingAIActions get executed.
   */
  onActionsReady?: () => void
}

const PM_SYSTEM_PROMPT = `You are a Project Manager AI coordinating a multi-agent team.

You are the decision-maker. Workers execute, you decide. Make every decision deliberately.

Your responsibilities:
- Reply to user questions in natural language about progress, status, findings
- Translate user instructions into concrete actions
- Decide team staffing: add workers when there's task backlog, remove idle ones to free slots
- Answer worker questions when they are blocked
- Make strategic decisions about priority and scheduling

When you receive a user message asking about progress/status/findings/anything conversational, you MUST include a "reply" action with a natural-language answer.
Use the team state (members, tasks) provided in context to compose accurate replies.

Action types (return as JSON array):
- {"type":"reply","content":"<natural language response to user>"}
- {"type":"assign_task","taskId":"...","memberId":"..."}
- {"type":"send_member_message","memberId":"...","message":"...","intent":"answer"}
- {"type":"broadcast","message":"...","intent":"message"}
- {"type":"cancel_task","taskId":"..."}
- {"type":"add_constraint","constraint":"..."}
- {"type":"complete","summary":"..."}
- {"type":"add_member","spec":{"role":"<display name>","agentType":"explore|plan|refactor|security-auditor|frontend-designer|general"},"message":"<reason>"}
- {"type":"remove_member","memberId":"...","force":false,"message":"<reason>"}

Staffing guidelines (you decide autonomously):
- Add a worker when: task queue > available members AND under 10-cap. Pick agentType matching the task type.
- Remove a worker when: it has been queued idle for a while AND remaining tasks don't need its skill set.
- Default remove: only target 'queued' members. Use force=true ONLY when explicitly user-requested or worker is stuck.
- Match agentType to work: read-only investigation → explore. Code writes → general/refactor. Security review → security-auditor.

Examples:
- User: "进度如何" → [{"type":"reply","content":"已完成 2/4 任务..."}]
- User: "通知所有人收尾" → [{"type":"broadcast","message":"...","intent":"wrap_up"},{"type":"reply","content":"已通知所有 worker 收尾。"}]
- 5 todo tasks, 2 idle members, no add capacity issues → [{"type":"add_member","spec":{"role":"Explorer D","agentType":"explore"},"message":"任务积压，加 1 个探索 worker"}]
- 1 task left, 4 idle members → [{"type":"remove_member","memberId":"member_xxx","message":"任务即将完成，裁减闲置成员"}]

Respond ONLY with a JSON array of actions. No prose before or after the array.`

const PM_PROACTIVE_PROMPT = `You are a Project Manager AI making AUTONOMOUS staffing/scheduling decisions.

You are NOT replying to a user message. You are evaluating team state on your own and deciding whether to adjust staffing or scheduling.

Decision rules:
- If todo tasks > queued+running workers AND total members < 10 → consider add_member
- If queued workers idle > 30 seconds AND no upcoming tasks need them → consider remove_member
- If a high-priority task is unassigned AND someone is queued → emit assign_task
- If everything is fine, output []

Action types:
- {"type":"add_member","spec":{"role":"...","agentType":"explore|plan|refactor|security-auditor|frontend-designer|general"},"message":"<reason>"}
- {"type":"remove_member","memberId":"...","force":false,"message":"<reason>"}
- {"type":"assign_task","taskId":"...","memberId":"..."}

Constraints:
- NEVER use type="reply" here — this is internal autonomous reasoning, no user is asking
- Match agentType to task type: read-only investigation → explore; code writes → general/refactor; security review → security-auditor
- Default remove only targets 'queued' members; do NOT remove running ones unless explicitly necessary
- Be conservative: if uncertain, output []. Don't churn workers unnecessarily.

Examples:
- 5 todo, 2 queued + 1 running, 3 total members → [{"type":"add_member","spec":{"role":"Worker D","agentType":"explore"},"message":"任务积压：5 待办仅 3 人"}]
- 0 todo, 4 queued, 1 running → [{"type":"remove_member","memberId":"member_xxx","message":"无待办任务，裁减闲置成员"}]
- 3 todo, 3 queued, 0 running → [{"type":"assign_task","taskId":"task_xxx","memberId":"member_yyy"},...]
- balanced state → []

Respond ONLY with a JSON array. No prose.`

const PM_STAFFING_FOLLOWUP_PROMPT = `You are a Project Manager AI making focused task-assignment decisions after a staffing change.

You will be told that a worker was just added or removed. Your only job is to assign or reassign tasks accordingly.

Decision rules:
- Match agentType to task work type:
  · explore → reading, searching, investigating code
  · plan → architecture analysis, planning
  · refactor → code structure improvements (no behavior change)
  · security-auditor → vulnerability/auth review
  · frontend-designer → UI implementation
  · general → mixed work, full tool access
- Respect dependencies: only assign tasks whose dependencies are completed
- Prioritize: urgent > high > normal > low
- Don't assign more than 1 task per worker (workers handle one at a time)

Action types (JSON array only):
- {"type":"assign_task","taskId":"...","memberId":"..."}
- {"type":"cancel_task","taskId":"..."}  ← only for redistribution after removal

Output ONLY a JSON array of actions. No reply, no broadcast, no add_member, no remove_member.
If no assignments are needed (e.g., no runnable tasks, or new member's skills don't match remaining work), output [].`

export class TeamManagerAI extends TeamManager {
  private provider: ModelProvider
  private modelConfig: ModelConfig
  private getMemberStates: () => TeamMemberState[]
  private objective: string
  private conversationHistory: Message[] = []
  private aiEnabled = true
  private aiProcessing = false
  private lastProactiveAt = 0
  private static PROACTIVE_THROTTLE_MS = 8000
  private static PENDING_ASSIGNMENT_TIMEOUT_MS = 5000
  /**
   * Members that just changed (added/affected by staffing) and are awaiting
   * PM AI's intelligent assignment. Base class decideTick will skip these
   * to avoid round-robin claiming them before AI weighs in.
   */
  private pendingAssignment = new Map<string, NodeJS.Timeout>()

  constructor(opts: TeamManagerAIOptions) {
    super(opts)
    this.provider = opts.provider
    this.modelConfig = opts.modelConfig
    this.getMemberStates = opts.memberStates
    this.objective = opts.objective
  }

  setAIEnabled(enabled: boolean): void {
    this.aiEnabled = enabled
  }

  /**
   * Override handleIntervention to use AI for complex decisions.
   * Falls back to base class logic for simple intents.
   */
  handleIntervention(msg: TeamMessage): ManagerAction[] {
    // Fast-path: simple intents that don't need AI thinking
    const fastPathIntents = new Set(['wrap_up', 'hurry', 'request_status'])
    if (fastPathIntents.has(msg.intent) || !this.aiEnabled) {
      return super.handleIntervention(msg)
    }

    // Direct member-targeted messages: still go through base class
    if (msg.to.startsWith('member:')) {
      this.queueAIDecision(msg)
      return super.handleIntervention(msg)
    }

    // User messages to PM: queue AI, but DON'T broadcast user text to workers
    // (base class would broadcast which is noisy and wrong)
    if (msg.intent === 'message') {
      this.queueAIDecision(msg)
      // Emit a manager_decision log for traceability, but no broadcast/forward
      this.opts.onEvent?.({
        type: 'intervention_received',
        from: msg.from === 'main_session' ? 'main_session' : 'user',
        intent: msg.intent,
        timestamp: Date.now(),
      })
      return []
    }

    // Other intents (assign, schedule, narrow_scope, etc.): combine base + AI
    this.queueAIDecision(msg)
    return super.handleIntervention(msg)
  }

  /**
   * Queue an AI decision for async processing.
   * The AI will produce additional actions that get executed on the next tick.
   */
  private queueAIDecision(msg: TeamMessage): void {
    if (this.aiProcessing) return
    this.aiProcessing = true

    this.processWithAI(msg).then(actions => {
      this.aiProcessing = false
      if (actions.length > 0) {
        this.pendingAIActions = [...this.pendingAIActions, ...actions]
        ;(this.opts as TeamManagerAIOptions).onActionsReady?.()
      }
    }).catch(() => {
      this.aiProcessing = false
    })
  }

  /**
   * Override decideTick to exclude members awaiting AI staffing assignment.
   * This prevents base class round-robin from claiming newly-added members
   * before PM AI has a chance to assign them intelligently.
   */
  decideTick(activeMemberCount: number, availableMemberIds: string[]): ManagerAction[] {
    const filtered = this.aiEnabled
      ? availableMemberIds.filter(id => !this.pendingAssignment.has(id))
      : availableMemberIds
    return super.decideTick(activeMemberCount, filtered)
  }

  /**
   * Called by TeamRuntime AFTER addMember/removeMember succeeds.
   * Triggers a focused, untrottled AI call so PM can intelligently
   * assign tasks to the new member (or redistribute after removal).
   */
  notifyStaffingChange(action: 'added' | 'removed', memberId: string, role: string, agentType?: string): void {
    if (!this.aiEnabled) return

    if (action === 'added') {
      // Reserve this member for AI to assign — block base round-robin briefly
      const existing = this.pendingAssignment.get(memberId)
      if (existing) clearTimeout(existing)
      const timeout = setTimeout(() => this.pendingAssignment.delete(memberId), TeamManagerAI.PENDING_ASSIGNMENT_TIMEOUT_MS)
      this.pendingAssignment.set(memberId, timeout)
    } else {
      // Released member is no longer pending
      const existing = this.pendingAssignment.get(memberId)
      if (existing) {
        clearTimeout(existing)
        this.pendingAssignment.delete(memberId)
      }
    }

    if (this.aiProcessing) {
      // Will be re-evaluated by AI's next decision; don't queue another concurrent call
      return
    }
    this.aiProcessing = true
    this.processStaffingFollowUp(action, memberId, role, agentType).then(actions => {
      this.aiProcessing = false
      // Once AI decides, release pending-assignment lock for this member
      const t = this.pendingAssignment.get(memberId)
      if (t) {
        clearTimeout(t)
        this.pendingAssignment.delete(memberId)
      }
      if (actions.length > 0) {
        this.pendingAIActions = [...this.pendingAIActions, ...actions]
        ;(this.opts as TeamManagerAIOptions).onActionsReady?.()
      }
    }).catch(() => {
      this.aiProcessing = false
      const t = this.pendingAssignment.get(memberId)
      if (t) {
        clearTimeout(t)
        this.pendingAssignment.delete(memberId)
      }
    })
  }

  private async processStaffingFollowUp(
    action: 'added' | 'removed',
    memberId: string,
    role: string,
    agentType?: string,
  ): Promise<ManagerAction[]> {
    const members = this.getMemberStates()
    const tasks = this.getTasks()

    const lines: string[] = []
    lines.push(`## Team Objective: ${this.objective}`)
    lines.push(`## Trigger: staffing_changed`)
    if (action === 'added') {
      lines.push(`## What Just Happened: A new worker "${role}" (${agentType ?? 'general'}, id=${memberId}) was just added to the team.`)
      lines.push(`Decide which tasks to assign — match agentType to task work type, respect dependencies, prioritize urgent/high.`)
    } else {
      lines.push(`## What Just Happened: Worker "${role}" (id=${memberId}) was removed.`)
      lines.push(`Any tasks they held have been released. Decide redistribution if needed.`)
    }
    lines.push('')
    lines.push('## Current Members:')
    for (const m of members) {
      lines.push(`- ${m.id} | ${m.role} | ${m.agentType} | ${m.status} | task: ${m.currentTaskId ?? 'none'}`)
    }
    lines.push('')
    lines.push('## Tasks:')
    for (const t of tasks) {
      lines.push(`- ${t.id} | "${t.title}" | ${t.status} | priority: ${t.priority} | assignee: ${t.assigneeId ?? 'unassigned'}${t.dependsOn ? ` | deps: ${JSON.stringify(t.dependsOn)}` : ''}`)
    }
    lines.push('')
    lines.push('Output assign_task actions ONLY. Do not reply, broadcast, or add/remove more members. Output [] if no assignments are needed right now.')

    try {
      const config: ModelConfig = {
        ...this.modelConfig,
        systemPrompt: PM_STAFFING_FOLLOWUP_PROMPT,
        maxTokens: 512,
      }
      const messages: Message[] = [
        { id: uuid(), role: 'user', content: [{ type: 'text', text: lines.join('\n') }], timestamp: Date.now() },
      ]
      let responseText = ''
      const stream = this.provider.stream(messages, [], config, undefined)
      for await (const chunk of stream) {
        if (chunk.type === 'text_delta') responseText += chunk.text || ''
      }
      // Only assign_task and cancel_task allowed in staffing follow-up
      return this.parseAIResponse(responseText).filter(a => a.type === 'assign_task' || a.type === 'cancel_task')
    } catch {
      return []
    }
  }

  /**
   * Trigger a proactive AI evaluation of team state.
   * Called from TeamRuntime on key events (task completed, task added, idle worker).
   * Throttled to avoid LLM spam.
   */
  triggerProactiveCheck(reason: string): void {
    if (!this.aiEnabled) return
    if (this.aiProcessing) return
    const now = Date.now()
    if (now - this.lastProactiveAt < TeamManagerAI.PROACTIVE_THROTTLE_MS) return
    this.lastProactiveAt = now
    this.aiProcessing = true

    this.processProactive(reason).then(actions => {
      this.aiProcessing = false
      if (actions.length > 0) {
        this.pendingAIActions = [...this.pendingAIActions, ...actions]
        ;(this.opts as TeamManagerAIOptions).onActionsReady?.()
      }
    }).catch(() => {
      this.aiProcessing = false
    })
  }

  private pendingAIActions: ManagerAction[] = []

  /**
   * Called by TeamRuntime to get any pending AI-generated actions.
   */
  consumeAIActions(): ManagerAction[] {
    const actions = this.pendingAIActions
    this.pendingAIActions = []
    return actions
  }

  private async processWithAI(msg: TeamMessage): Promise<ManagerAction[]> {
    const members = this.getMemberStates()
    const tasks = this.getTasks()

    const context = this.buildContextPrompt(members, tasks, msg)
    this.conversationHistory.push({
      id: uuid(),
      role: 'user',
      content: [{ type: 'text', text: context }],
      timestamp: Date.now(),
    })

    try {
      const config: ModelConfig = {
        ...this.modelConfig,
        systemPrompt: PM_SYSTEM_PROMPT,
        maxTokens: 1024,
      }

      let responseText = ''
      const stream = this.provider.stream(
        this.conversationHistory,
        [],
        config,
        undefined
      )

      for await (const chunk of stream) {
        if (chunk.type === 'text_delta') {
          responseText += chunk.text || ''
        }
      }

      this.conversationHistory.push({
        id: uuid(),
        role: 'assistant',
        content: [{ type: 'text', text: responseText }],
        timestamp: Date.now(),
      })

      // Keep conversation history bounded
      if (this.conversationHistory.length > 20) {
        this.conversationHistory = this.conversationHistory.slice(-14)
      }

      return this.parseAIResponse(responseText)
    } catch {
      return []
    }
  }

  /**
   * Run an autonomous AI evaluation without an incoming user message.
   * Used for proactive staffing/scheduling decisions.
   */
  private async processProactive(reason: string): Promise<ManagerAction[]> {
    const members = this.getMemberStates()
    const tasks = this.getTasks()

    // Quick gate: skip if there's nothing actionable
    const todoCount = tasks.filter(t => t.status === 'todo').length
    const queuedMembers = members.filter(m => m.status === 'queued').length
    const runningMembers = members.filter(m => m.status === 'running').length
    if (todoCount === 0 && queuedMembers === 0) return []

    const lines: string[] = []
    lines.push(`## Team Objective: ${this.objective}`)
    lines.push(`## Trigger: ${reason}`)
    lines.push('')
    lines.push('## Current Members:')
    for (const m of members) {
      const idle = m.status === 'queued' ? ` (idle ${Math.floor((Date.now() - m.lastActivityAt) / 1000)}s)` : ''
      lines.push(`- ${m.id} | ${m.role} | ${m.agentType} | ${m.status}${idle}`)
    }
    lines.push('')
    lines.push('## Tasks:')
    for (const t of tasks) {
      lines.push(`- ${t.id} | "${t.title}" | ${t.status} | priority: ${t.priority}`)
    }
    lines.push('')
    lines.push(`## Stats: ${todoCount} todo, ${runningMembers} running, ${queuedMembers} idle workers`)
    lines.push('')
    lines.push('Decide ONLY about staffing/scheduling adjustments. Do NOT reply to anyone (no user message). Output [] if no action needed.')

    try {
      const config: ModelConfig = {
        ...this.modelConfig,
        systemPrompt: PM_PROACTIVE_PROMPT,
        maxTokens: 512,
      }
      const messages: Message[] = [
        { id: uuid(), role: 'user', content: [{ type: 'text', text: lines.join('\n') }], timestamp: Date.now() },
      ]
      let responseText = ''
      const stream = this.provider.stream(messages, [], config, undefined)
      for await (const chunk of stream) {
        if (chunk.type === 'text_delta') responseText += chunk.text || ''
      }
      // Filter out reply actions — proactive checks shouldn't talk to user
      return this.parseAIResponse(responseText).filter(a => a.type !== 'reply')
    } catch {
      return []
    }
  }

  private buildContextPrompt(members: TeamMemberState[], tasks: TeamTask[], msg: TeamMessage): string {
    const lines: string[] = []
    lines.push(`## Team Objective: ${this.objective}`)
    lines.push('')
    lines.push('## Current Members:')
    for (const m of members) {
      lines.push(`- ${m.id} | role: ${m.role} | type: ${m.agentType} | status: ${m.status} | task: ${m.currentTaskId ?? 'none'}`)
    }
    lines.push('')
    lines.push('## Tasks:')
    for (const t of tasks) {
      lines.push(`- ${t.id} | "${t.title}" | status: ${t.status} | assignee: ${t.assigneeId ?? 'unassigned'} | priority: ${t.priority}`)
    }
    lines.push('')
    lines.push(`## Incoming Message:`)
    lines.push(`From: ${msg.from}${msg.fromMemberId ? ` (${msg.fromMemberId})` : ''}`)
    lines.push(`Intent: ${msg.intent}`)
    lines.push(`Content: ${msg.content}`)
    lines.push('')
    lines.push('Decide what actions to take. Respond with a JSON array.')
    return lines.join('\n')
  }

  private parseAIResponse(text: string): ManagerAction[] {
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) return []
      const parsed = JSON.parse(jsonMatch[0])
      if (!Array.isArray(parsed)) return []

      const validTypes = new Set(['assign_task', 'cancel_task', 'send_member_message', 'broadcast', 'add_constraint', 'complete', 'reply', 'add_member', 'remove_member'])
      return parsed
        .filter((a: any) => a && validTypes.has(a.type))
        .map((a: any) => {
          // Normalize `content` field → `message` so executeActions sees it consistently
          if (a.content && !a.message) {
            return { ...a, message: a.content }
          }
          return a
        }) as ManagerAction[]
    } catch {
      return []
    }
  }
}
