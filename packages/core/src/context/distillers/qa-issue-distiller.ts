import type { ContextCitation, DistillerOutput, HarvestCandidate, ToolExecutionEvent } from '../types.js'
import type { ContextDistiller } from './index.js'
import { completeDistillerEnvelopeWithModel } from './model-client.js'

export const qaIssueDistiller: ContextDistiller = {
  name: 'QaIssueDistiller',
  async distill(candidate, context) {
    const deterministic = deterministicQaIssue(candidate)
    if (deterministic) return deterministic
    if (!context.modelClient) return skip('no structured Team QA issue evidence')
    return completeDistillerEnvelopeWithModel({
      distiller: 'QaIssueDistiller',
      candidate,
      binding: context.modelBinding,
      maxOutputTokens: context.maxOutputTokens,
    }, context.modelClient)
  },
}

function deterministicQaIssue(candidate: HarvestCandidate): DistillerOutput | undefined {
  const teamId = candidate.origin?.teamId
  if (!teamId) return undefined
  const event = candidate.toolEvents.find(isTeamArtifactEvent)
  if (!event) return undefined
  const issueId = eventString(event, ['issueId', 'issue_id', 'target_id', 'targetId']) || issueIdFromText(candidate.userMessage)
  if (!issueId) return undefined
  const status = eventString(event, ['new_status', 'newStatus', 'status']) || 'open'
  return {
    schemaVersion: 1,
    distiller: 'QaIssueDistiller',
    confidence: 0.9,
    citations: citationForEvent(candidate, event),
    payload: {
      issueId,
      title: eventString(event, ['issue_title', 'issueTitle', 'title']) || issueId,
      status: qaStatus(status),
      severity: qaSeverity(eventString(event, ['severity'])),
      summary: eventString(event, ['summary', 'resolution', 'content']) || candidate.userMessage.trim() || `Team QA issue ${issueId}.`,
      teamId,
      taskId: candidate.origin?.taskId ?? eventString(event, ['task_id', 'taskId', 'on_task', 'onTask']),
      confidence: 0.9,
    },
  }
}

function skip(diagnostic: string): DistillerOutput {
  return { schemaVersion: 1, distiller: 'QaIssueDistiller', action: 'skip', reason: 'model_noop', confidence: 0.9, diagnostic }
}

function isTeamArtifactEvent(event: ToolExecutionEvent): boolean {
  return event.name === 'team_artifact' || eventString(event, ['name', 'toolName']) === 'team_artifact'
}

function citationForEvent(candidate: HarvestCandidate, event: ToolExecutionEvent): ContextCitation[] {
  return event.id ? [{ id: `cit_team_tool_${event.id}`, type: 'tool_event', ref: event.id }] : [{ id: `cit_team_${candidate.runLoopId}_user`, type: 'message', ref: `${candidate.runLoopId}:user` }]
}

function issueIdFromText(text: string): string {
  return text.match(/ISSUE-\d+/i)?.[0] ?? ''
}

function qaStatus(value: string): 'open' | 'in_progress' | 'resolved' | 'wontfix' {
  if (value === 'in_progress' || value === 'resolved' || value === 'wontfix') return value
  return 'open'
}

function qaSeverity(value: string): 'low' | 'medium' | 'high' | 'critical' {
  if (value === 'low' || value === 'high' || value === 'critical') return value
  return 'medium'
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
