import type { FileReadStateCache } from '../file-read-state.js'
import type { ToolResult } from '../tool-registry.js'
import { evaluateFileMutationPolicy } from './file-mutation-policy.js'
import { PolicyEventLedger } from './policy-events.js'
import { classifyVerificationCommand } from './tool-output-classifier.js'
import { VerificationLedger } from './verification-ledger.js'

export type ConstraintPreToolDecision = { decision: 'allow' } | { decision: 'block'; reason: string }

export interface ConstraintPolicyRuntimeOptions {
  now?: () => number
}

export interface ConstraintToolContext {
  toolName: string
  toolUseId?: string
  input: Record<string, unknown>
  cwd: string
  fileReadState: FileReadStateCache
}

export interface ConstraintPostToolContext extends ConstraintToolContext {
  result: ToolResult
}

export class ConstraintPolicyRuntime {
  readonly policyEvents: PolicyEventLedger
  readonly verificationLedger: VerificationLedger

  constructor(options: ConstraintPolicyRuntimeOptions = {}) {
    this.policyEvents = new PolicyEventLedger({ now: options.now })
    this.verificationLedger = new VerificationLedger({ now: options.now })
  }

  preToolUse(context: ConstraintToolContext): ConstraintPreToolDecision {
    const mutationDecision = evaluateFileMutationPolicy({
      toolName: context.toolName,
      input: context.input,
      cwd: context.cwd,
      fileReadState: context.fileReadState,
    })

    this.policyEvents.record({
      phase: 'pre_tool_use',
      source: 'FileMutationPolicy',
      decision: mutationDecision.decision,
      ...(mutationDecision.decision === 'block' ? { reason: mutationDecision.reason } : {}),
      toolName: context.toolName,
      toolUseId: context.toolUseId,
      cwd: context.cwd,
    })

    return mutationDecision
  }

  postToolUse(context: ConstraintPostToolContext): void {
    const command = context.result.metadata?.command
    if (context.result.isError && !command) return

    if (!context.result.isError) {
      const fileRead = context.result.metadata?.fileRead
      if (fileRead) {
        context.fileReadState.recordRead(
          fileRead.filePath,
          fileRead.offset,
          fileRead.limit,
          fileRead.totalLines,
          fileRead.content
        )
        this.policyEvents.record({
          phase: 'post_tool_use',
          source: 'ToolResultMetadata',
          decision: 'record',
          toolName: context.toolName,
          toolUseId: context.toolUseId,
          cwd: context.cwd,
        })
      }

      for (const mutation of context.result.metadata?.mutations ?? []) {
        context.fileReadState.invalidate(mutation.filePath)
        this.verificationLedger.recordMutation({
          filePath: mutation.filePath,
          toolUseId: context.toolUseId ?? '',
        })
        this.policyEvents.record({
          phase: 'post_tool_use',
          source: 'VerificationLedger',
          decision: 'record',
          toolName: context.toolName,
          toolUseId: context.toolUseId,
          cwd: context.cwd,
        })
      }
    }

    if (command) {
      const classified = classifyVerificationCommand(command.command)
      if (classified) {
        this.verificationLedger.recordCommand({
          toolUseId: context.toolUseId ?? '',
          command: command.command,
          kind: classified.kind,
          status: command.exitCode === 0 && !context.result.isError ? 'passed' : 'failed',
          output: context.result.content,
        })
        this.policyEvents.record({
          phase: 'post_tool_use',
          source: 'VerificationLedger',
          decision: 'record',
          toolName: context.toolName,
          toolUseId: context.toolUseId,
          cwd: context.cwd,
        })
      }
    }
  }
}
