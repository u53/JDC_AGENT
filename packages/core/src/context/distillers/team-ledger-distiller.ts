import type { ContextCitation, DistillerOutput, HarvestCandidate, ToolExecutionEvent } from '../types.js'
import type { ContextDistiller } from './index.js'
import { completeDistillerEnvelopeWithModel } from './model-client.js'

export const teamLedgerDistiller: ContextDistiller = {
  name: 'TeamLedgerDistiller',
  async distill(candidate, context) {
    const deterministic = deterministicTeamLedger(candidate)
    if (deterministic) return deterministic
    if (!context.modelClient) return skip('no durable team ledger fact')
    return completeDistillerEnvelopeWithModel({
      distiller: 'TeamLedgerDistiller',
      candidate,
      binding: context.modelBinding,
      maxOutputTokens: context.maxOutputTokens,
    }, context.modelClient)
  },
}

function deterministicTeamLedger(candidate: HarvestCandidate): DistillerOutput | undefined {
  const teamId = candidate.origin?.teamId
  if (!teamId) return undefined
  const event = candidate.toolEvents.find(isTeamArtifactEvent)
  const action = event ? eventString(event, ['action', 'toolAction']) : ''
  const status = event ? eventString(event, ['new_status', 'newStatus', 'status']) : ''

  if (candidate.origin?.actor === 'team_pm' && durableDecision(candidate.userMessage)) {
    return envelope(candidate, {
      kind: 'team_decision',
      summary: candidate.userMessage.trim(),
      teamId,
      taskId: candidate.origin.taskId,
      memberId: candidate.origin.memberId,
      confidence: 0.9,
    })
  }

  if (candidate.origin?.actor === 'team_worker' && event && action === 'update_status' && status === 'completed') {
    return envelope(candidate, {
      kind: 'task_result',
      summary: summaryFromEvent(event, candidate.userMessage),
      teamId,
      taskId: candidate.origin.taskId ?? eventString(event, ['task_id', 'taskId', 'target_id', 'targetId']),
      memberId: candidate.origin.memberId,
      confidence: 0.9,
    }, citationForEvent(candidate, event))
  }

  return undefined
}

function envelope(candidate: HarvestCandidate, payload: Record<string, unknown>, citations = [messageCitation(candidate)]): DistillerOutput {
  return {
    schemaVersion: 1,
    distiller: 'TeamLedgerDistiller',
    confidence: 0.9,
    citations,
    payload,
  }
}

function skip(diagnostic: string): DistillerOutput {
  return { schemaVersion: 1, distiller: 'TeamLedgerDistiller', action: 'skip', reason: 'model_noop', confidence: 0.9, diagnostic }
}

function durableDecision(text: string): boolean {
  const normalized = text.trim()
  if (normalized.length < 12) return false
  if (/(思考中|等待|处理中|reviewing|waiting|thinking|in progress|status update|heartbeat)/i.test(normalized)) return false
  return /(decision|decided|must|keep|choose|chosen|adopt|决定|决策|必须|保持|采用|约定|选择)/i.test(normalized)
}

function isTeamArtifactEvent(event: ToolExecutionEvent): boolean {
  return event.name === 'team_artifact' || eventString(event, ['name', 'toolName']) === 'team_artifact'
}

function summaryFromEvent(event: ToolExecutionEvent, fallback: string): string {
  return eventString(event, ['summary', 'resolution', 'content']) || fallback.trim() || 'Team task completed.'
}

function messageCitation(candidate: HarvestCandidate): ContextCitation {
  return { id: `cit_team_${candidate.runLoopId}_user`, type: 'message', ref: `${candidate.runLoopId}:user` }
}

function citationForEvent(candidate: HarvestCandidate, event: ToolExecutionEvent): ContextCitation[] {
  return event.id ? [{ id: `cit_team_tool_${event.id}`, type: 'tool_event', ref: event.id }] : [messageCitation(candidate)]
}

function eventString(event: ToolExecutionEvent, keys: string[]): string {
  const record = event as Record<string, unknown>
  for (const key of keys) {
    const direct = record[key]
    if (typeof direct === 'string') return direct.trim()
    for (const holderKey of ['input', 'args', 'arguments', 'params']) {
      const holder = record[holderKey]
      if (holder && typeof holder === 'object' && !Array.isArray(holder)) {
        const value = (holder as Record<string, unknown>)[key]
        if (typeof value === 'string') return value.trim()
      }
    }
  }
  return ''
}
