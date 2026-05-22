import { v4 as uuid } from 'uuid'
import { runSubSession, type SubSessionOptions, type SubSessionResult } from '../sub-session.js'
import { Mailbox, type MailboxMessage } from './team-mailbox.js'
import { createTeamReportTool } from '../tools/team-report.js'
import { createTeamArtifactTool } from '../tools/team-artifact.js'
import type { TeamWorkspace } from './team-workspace.js'
import type {
  TeamMemberState,
  TeamMemberSpec,
  MemberStatus,
  TeamCapability,
  TeamMessage,
  TeamEvent,
  TeamTaskResult,
} from './team-types.js'

const READ_ONLY_TYPES = new Set(['explore', 'plan', 'security-auditor'])
const WRITE_TYPES = new Set(['general', 'refactor', 'frontend-designer'])
const SHELL_TYPES = new Set(['general', 'security-auditor'])

function deriveCapabilities(agentType: string): TeamCapability[] {
  const caps: TeamCapability[] = ['read']
  if (WRITE_TYPES.has(agentType)) caps.push('write')
  if (SHELL_TYPES.has(agentType)) caps.push('shell')
  return caps
}

export interface TeamMemberOptions {
  spec: TeamMemberSpec
  taskPrompt: string
  taskId?: string
  id?: string
  existingMailbox?: Mailbox
  teamMailbox?: { push(msg: any): void }
  workspace?: TeamWorkspace
  subSessionDeps: Omit<SubSessionOptions, 'prompt' | 'agentType' | 'signal' | 'onAgentProgress' | 'onAgentText' | 'mailbox' | 'onToolEvent'>
  onEvent?: (event: TeamEvent) => void
  onComplete?: (memberId: string, result: TeamTaskResult) => void
  onFail?: (memberId: string, error: string) => void
}

export class TeamMember {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly agentType: string
  readonly modelId?: string

  private status: MemberStatus = 'queued'
  private currentTaskId?: string
  private toolCount = 0
  private lastActivityAt: number = Date.now()
  private textBuffer = ''
  private result?: TeamTaskResult
  private capabilities: TeamCapability[]

  private mailbox = new Mailbox()
  private abortController = new AbortController()
  private opts: TeamMemberOptions
  private runPromise?: Promise<void>

  constructor(opts: TeamMemberOptions) {
    this.opts = opts
    this.id = opts.id ?? `member_${uuid().slice(0, 8)}`
    this.role = opts.spec.role
    this.name = opts.spec.role
    this.agentType = opts.spec.agentType ?? 'explore'
    this.modelId = opts.spec.modelId
    this.currentTaskId = opts.taskId
    this.capabilities = deriveCapabilities(this.agentType)
    if (opts.existingMailbox) {
      this.mailbox = opts.existingMailbox
    }
  }

  getState(): TeamMemberState {
    return {
      id: this.id,
      name: this.name,
      role: this.role,
      agentType: this.agentType,
      modelId: this.modelId,
      status: this.status,
      capabilities: this.capabilities,
      currentTaskId: this.currentTaskId,
      lastActivityAt: this.lastActivityAt,
      toolCount: this.toolCount,
      result: this.result,
    }
  }

  getStatus(): MemberStatus {
    return this.status
  }

  getMailboxLength(): number {
    return this.mailbox.length
  }

  getMailbox(): Mailbox {
    return this.mailbox
  }

  sendMessage(msg: TeamMessage): void {
    const mb: MailboxMessage = {
      id: msg.id,
      from: msg.from + (msg.fromMemberId ? `:${msg.fromMemberId}` : ''),
      content: msg.content,
      intent: msg.intent,
      priority: msg.priority,
      createdAt: msg.createdAt,
    }
    this.mailbox.push(mb)
    this.lastActivityAt = Date.now()

    // Interrupt current execution for wrap_up (hard stop).
    // hurry is intentionally NOT here — abort would kill mid-stream and fail the task.
    // For "stuck worker" rescue, PM should use kick_member instead.
    if (msg.intent === 'wrap_up') {
      this.interruptCurrentExecution()
    }
  }

  abort(): void {
    this.abortController.abort()
    this.status = 'stopped'
  }

  /**
   * Interrupt the worker's current tool execution.
   * Aborts the signal so the sub-session's current tool call and streaming stop.
   */
  interruptCurrentExecution(): void {
    if (this.status !== 'running') return
    this.abortController.abort()
  }

  async start(): Promise<void> {
    if (this.runPromise) return this.runPromise
    this.runPromise = this.run()
    return this.runPromise
  }

  private async run(): Promise<void> {
    this.status = 'running'
    this.lastActivityAt = Date.now()

    try {
      // Build extra tools for team communication
      const extraTools: SubSessionOptions['extraTools'] = []
      if (this.opts.teamMailbox) {
        const reportTool = createTeamReportTool({
          memberId: this.id,
          teamMailbox: this.opts.teamMailbox,
          onReport: (_mid, report) => {
            this.opts.onEvent?.({
              type: 'member_progress',
              memberId: this.id,
              text: `[${report.type}] ${report.content.slice(0, 100)}`,
              timestamp: Date.now(),
            })
          },
        })
        extraTools.push({
          definition: reportTool.definition as any,
          execute: reportTool.execute as any,
        })
      }

      if (this.opts.workspace && this.opts.taskId) {
        const artifactTool = createTeamArtifactTool({
          memberId: this.id,
          taskId: this.opts.taskId,
          workspace: this.opts.workspace,
          teamMailbox: this.opts.teamMailbox,
        })
        extraTools.push({
          definition: artifactTool.definition as any,
          execute: artifactTool.execute as any,
        })
      }

      const subOpts: SubSessionOptions = {
        ...this.opts.subSessionDeps,
        prompt: this.opts.taskPrompt,
        agentType: this.agentType,
        signal: this.abortController.signal,
        mailbox: this.mailbox,
        extraTools: extraTools.length > 0 ? extraTools : undefined,
        onAgentProgress: (event) => {
          this.toolCount = event.toolCount
          this.lastActivityAt = Date.now()
          if (event.toolStatus === 'start') {
            this.opts.onEvent?.({
              type: 'tool_start',
              memberId: this.id,
              toolName: event.toolName,
              timestamp: Date.now(),
            })
          } else if (event.toolStatus === 'error') {
            const reason = event.toolResult?.content
              ? String(event.toolResult.content).slice(0, 160)
              : undefined
            this.opts.onEvent?.({
              type: 'tool_error',
              memberId: this.id,
              toolName: event.toolName,
              reason,
              timestamp: Date.now(),
            })
          } else {
            this.opts.onEvent?.({
              type: 'tool_complete',
              memberId: this.id,
              toolName: event.toolName,
              timestamp: Date.now(),
            })
          }
        },
        onAgentText: (text) => {
          this.textBuffer += text
          this.lastActivityAt = Date.now()
          this.opts.onEvent?.({
            type: 'member_progress',
            memberId: this.id,
            text,
            timestamp: Date.now(),
          })
        },
      }

      const result: SubSessionResult = await runSubSession(subOpts)

      const taskResult: TeamTaskResult = {
        summary: result.content,
        findings: [],
      }
      this.result = taskResult
      this.status = 'completed'
      this.lastActivityAt = Date.now()
      this.opts.onComplete?.(this.id, taskResult)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.status = 'failed'
      this.lastActivityAt = Date.now()
      this.opts.onFail?.(this.id, errorMsg)
    }
  }
}
