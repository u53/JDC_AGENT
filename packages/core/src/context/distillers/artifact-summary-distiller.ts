import type { ContextCitation, DistillerOutput, HarvestCandidate, ToolExecutionEvent } from '../types.js'
import type { ContextDistiller } from './index.js'
import { completeDistillerEnvelopeWithModel } from './model-client.js'

export const artifactSummaryDistiller: ContextDistiller = {
  name: 'ArtifactSummaryDistiller',
  async distill(candidate, context) {
    const deterministic = deterministicArtifactSummary(candidate)
    if (deterministic) return deterministic
    if (!context.modelClient) return skip('no structured Team artifact evidence')
    return completeDistillerEnvelopeWithModel({
      distiller: 'ArtifactSummaryDistiller',
      candidate,
      binding: context.modelBinding,
      maxOutputTokens: context.maxOutputTokens,
    }, context.modelClient)
  },
}

function deterministicArtifactSummary(candidate: HarvestCandidate): DistillerOutput | undefined {
  const teamId = candidate.origin?.teamId
  if (!teamId) return undefined
  const event = candidate.toolEvents.find(isTeamArtifactEvent)
  if (!event) return undefined
  const action = eventString(event, ['action', 'toolAction'])
  if (action === 'create_issue') return undefined

  const taskId = candidate.origin?.taskId ?? eventString(event, ['task_id', 'taskId', 'target_id', 'targetId'])
  return {
    schemaVersion: 1,
    distiller: 'ArtifactSummaryDistiller',
    confidence: 0.9,
    citations: citationForEvent(candidate, event),
    payload: {
      artifactId: eventString(event, ['artifact_id', 'artifactId', 'contract_name', 'contractName', 'target_id', 'targetId']) || event.id,
      summary: eventString(event, ['summary', 'content', 'resolution']) || candidate.userMessage.trim() || 'Team artifact was written.',
      artifactType: eventString(event, ['type', 'artifactType']) || action || undefined,
      teamId,
      taskId: taskId || undefined,
      memberId: candidate.origin?.memberId,
      confidence: 0.9,
    },
  }
}

function skip(diagnostic: string): DistillerOutput {
  return { schemaVersion: 1, distiller: 'ArtifactSummaryDistiller', action: 'skip', reason: 'model_noop', confidence: 0.9, diagnostic }
}

function isTeamArtifactEvent(event: ToolExecutionEvent): boolean {
  return event.name === 'team_artifact' || eventString(event, ['name', 'toolName']) === 'team_artifact'
}

function citationForEvent(candidate: HarvestCandidate, event: ToolExecutionEvent): ContextCitation[] {
  return event.id ? [{ id: `cit_team_tool_${event.id}`, type: 'tool_event', ref: event.id }] : [{ id: `cit_team_${candidate.runLoopId}_user`, type: 'message', ref: `${candidate.runLoopId}:user` }]
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
