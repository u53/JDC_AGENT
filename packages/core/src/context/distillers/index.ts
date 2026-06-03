import type { ZodObject, ZodRawShape } from 'zod'
import type { DistillerEnvelope, DistillerOutput, HarvestCandidate, HarvestDecision, HarvestModelBinding } from '../types.js'
import type { AcceptanceOptions, AcceptanceResult } from '../safety.js'
import { validateDistillerEnvelopeForAcceptance } from '../safety.js'
import {
  CodeTaskPayloadSchema,
  ArtifactSummaryPayloadSchema,
  ConversationStatePayloadSchema,
  MemoryCandidatePayloadSchema,
  ProjectProfilePayloadSchema,
  QaIssuePayloadSchema,
  RuntimeNarrativePayloadSchema,
  TeamLedgerPayloadSchema,
  WorkflowRulePayloadSchema,
} from '../schemas.js'
import { runtimeNarrativeDistiller } from './runtime-narrative-distiller.js'
import { conversationStateDistiller } from './conversation-state-distiller.js'
import { memoryCuratorDistiller } from './memory-curator-distiller.js'
import { projectProfileDistiller } from './project-profile-distiller.js'
import { codeTaskDistiller } from './code-task-distiller.js'
import { teamLedgerDistiller } from './team-ledger-distiller.js'
import { artifactSummaryDistiller } from './artifact-summary-distiller.js'
import { qaIssueDistiller } from './qa-issue-distiller.js'
import { workflowRuleDistiller } from './workflow-rule-distiller.js'
import type { DistillerModelClient } from './model-client.js'
export type { DistillerModelClient } from './model-client.js'
export { createProviderDistillerModelClient } from './model-client.js'

export interface DistillerContext {
  modelBinding: HarvestModelBinding
  modelClient?: DistillerModelClient
  maxOutputTokens?: number
}

export interface ContextDistiller {
  name: string
  distill(candidate: HarvestCandidate, context: DistillerContext): Promise<DistillerOutput>
}

export const defaultHarvestDistillers: ContextDistiller[] = [
  runtimeNarrativeDistiller,
  conversationStateDistiller,
  memoryCuratorDistiller,
  projectProfileDistiller,
  codeTaskDistiller,
  teamLedgerDistiller,
  artifactSummaryDistiller,
  qaIssueDistiller,
  workflowRuleDistiller,
]

const payloadSchemas = {
  RuntimeNarrativeDistiller: RuntimeNarrativePayloadSchema,
  ConversationStateDistiller: ConversationStatePayloadSchema,
  MemoryCuratorDistiller: MemoryCandidatePayloadSchema,
  ProjectProfileDistiller: ProjectProfilePayloadSchema,
  CodeTaskDistiller: CodeTaskPayloadSchema,
  TeamLedgerDistiller: TeamLedgerPayloadSchema,
  ArtifactSummaryDistiller: ArtifactSummaryPayloadSchema,
  QaIssueDistiller: QaIssuePayloadSchema,
  WorkflowRuleDistiller: WorkflowRulePayloadSchema,
} satisfies Record<string, ZodObject<ZodRawShape>>

export function validateDistillerOutput(envelope: DistillerEnvelope, options: AcceptanceOptions = {}): AcceptanceResult<DistillerEnvelope> {
  const errors: string[] = []
  const schema = payloadSchemas[envelope.distiller as keyof typeof payloadSchemas]
  if (!schema) errors.push(`unknown distiller ${envelope.distiller}`)
  if (schema) {
    const payload = schema.strict().safeParse(envelope.payload)
    if (!payload.success) errors.push(`payload schema invalid: ${payload.error.message}`)
  }

  const accepted = validateDistillerEnvelopeForAcceptance(envelope, options)
  errors.push(...accepted.errors)

  return errors.length === 0 ? { accepted: true, value: envelope, errors: [] } : { accepted: false, errors: [...new Set(errors)] }
}

export function selectDistillerForDecision(decision: HarvestDecision, distillers: ContextDistiller[] = defaultHarvestDistillers): ContextDistiller | undefined {
  switch (decision.action) {
    case 'distill_runtime':
      return distillers.find((distiller) => distiller.name === 'RuntimeNarrativeDistiller')
    case 'distill_conversation':
      return distillers.find((distiller) => distiller.name === 'ConversationStateDistiller')
    case 'distill_memory_candidate':
      return distillers.find((distiller) => distiller.name === 'MemoryCuratorDistiller')
    case 'distill_project_update':
      return distillers.find((distiller) => distiller.name === 'ProjectProfileDistiller') ?? distillers.find((distiller) => distiller.name === 'CodeTaskDistiller')
    case 'distill_team_ledger':
      return distillers.find((distiller) => distiller.name === 'TeamLedgerDistiller')
    case 'distill_artifact_summary':
      return distillers.find((distiller) => distiller.name === 'ArtifactSummaryDistiller')
    case 'distill_qa_issue':
      return distillers.find((distiller) => distiller.name === 'QaIssueDistiller')
    case 'distill_workflow_rule':
      return distillers.find((distiller) => distiller.name === 'WorkflowRuleDistiller')
    case 'skip':
      return undefined
  }
}
