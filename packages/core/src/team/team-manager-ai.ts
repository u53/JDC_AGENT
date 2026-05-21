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

export class TeamManagerAI extends TeamManager {
  private provider: ModelProvider
  private modelConfig: ModelConfig
  private getMemberStates: () => TeamMemberState[]
  private objective: string
  private conversationHistory: Message[] = []
  private aiEnabled = true
  private aiProcessing = false

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
        this.pendingAIActions = actions
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
