import { z } from 'zod'
import type {
  ContextBundle,
  ContextEngineConfig,
  ContextFact,
  ContextProviderId,
  DistillerEnvelope,
  DistillerBatchOutput,
  DistillerOutput,
  DistillerSkipOutput,
  HarvestDecision,
  MemoryRecord,
} from './types.js'

const confidenceSchema = z.number().finite().gt(0).lte(1)
const timestampSchema = z.number().int().nonnegative()
const nonEmptyStringSchema = z.string().min(1)

export const ContextModeSchema = z.enum(['chat', 'debug', 'code_edit', 'review', 'plan'])
export const ContextFreshnessSchema = z.enum(['live', 'recent', 'cached', 'stale'])
export const ContextFactStatusSchema = z.enum(['active', 'stale', 'superseded', 'conflicted', 'archived'])
export const ContextScopeSchema = z.enum(['global', 'project', 'repo', 'session', 'turn'])
export const MemoryScopeSchema = z.enum(['global', 'project', 'repo', 'session'])
export const EvidenceKindSchema = z.enum(['file', 'git', 'tool_event', 'message', 'memory', 'ide', 'config', 'task', 'diagnostic'])
export const ContextFactKindSchema = z.enum(['project_profile', 'architecture_decision', 'module_boundary', 'user_preference', 'current_goal', 'runtime_error_chain', 'code_entrypoint', 'known_issue', 'project_convention', 'workflow_rule', 'team_decision', 'task_result', 'artifact_summary', 'qa_issue'])
export const ContextSectionKindSchema = z.enum(['agent_contract', 'user_intent', 'project_profile', 'code_map', 'relevant_code', 'repo_wiki', 'git_state', 'memory', 'conversation_state', 'runtime_state', 'ide_state', 'diagnostics'])
export const SkipReasonSchema = z.enum(['greeting_or_smalltalk', 'no_new_fact', 'too_short', 'duplicate_of_existing_context', 'low_confidence', 'sensitive_content', 'rate_limited', 'model_noop', 'cancelled', 'timeout'])
export const HarvestStatusSchema = z.enum(['queued', 'classified', 'distilling', 'validating', 'accepted', 'pending_review', 'rejected', 'skipped', 'failed'])
export const ProviderProtocolSchema = z.enum(['anthropic', 'openai-chat', 'openai-responses'])
export const ContextActorSchema = z.enum(['main_session', 'subagent', 'team_pm', 'team_worker', 'system', 'user'])
export const MemoryRecordKindSchema = z.enum(['user_preference', 'project_convention', 'architecture_decision', 'known_issue', 'workflow_hint'])
export const ContextProviderIdSchema = z.enum(['code', 'repo_wiki', 'project', 'workflow', 'git', 'conversation', 'memory', 'runtime', 'ide'])

const ContextOwnershipSchema = z.object({
  authority: z.enum([
    'system_instruction',
    'project_instruction',
    'current_user',
    'live_state',
    'runtime_evidence',
    'code_evidence',
    'durable_memory',
    'derived_state',
  ]),
  topic: z.enum([
    'project_instruction',
    'project_profile',
    'workflow',
    'git',
    'task',
    'runtime',
    'ide',
    'code',
    'memory',
    'conversation',
  ]),
  conflictPolicy: z.enum(['render', 'suppress_if_carried', 'pointer_only']),
  refs: z.array(z.string()).optional(),
})

const CarriedContextMetadataSchema = z.object({
  projectInstructionRefs: z.array(z.string()),
  gitStatusInSystemPrompt: z.boolean(),
  taskRefs: z.array(z.string()),
})

export const ContextOriginSchema = z.object({
  projectKey: nonEmptyStringSchema,
  actor: ContextActorSchema,
  sessionId: z.string().optional(),
  runLoopId: z.string().optional(),
  subSessionId: z.string().optional(),
  teamId: z.string().optional(),
  memberId: z.string().optional(),
  taskId: z.string().optional(),
  artifactId: z.string().optional(),
  toolUseId: z.string().optional(),
  messageId: z.string().optional(),
  providerProtocol: ProviderProtocolSchema.optional(),
  modelId: z.string().optional(),
})

const stringListSchema = z.array(nonEmptyStringSchema)

export const ContextCitationSchema = z
  .object({
    id: nonEmptyStringSchema,
    type: EvidenceKindSchema,
    ref: nonEmptyStringSchema,
    line: z.number().int().positive().optional(),
    range: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
    timestamp: timestampSchema.optional(),
    hash: nonEmptyStringSchema.optional(),
  })
  .refine((citation) => !citation.range || citation.range[0] <= citation.range[1], 'citation range must be ordered')

const citedArraySchema = z.array(ContextCitationSchema).min(1, 'durable context requires at least one citation')

const MessageSchema = z.object({ id: nonEmptyStringSchema, role: z.string(), content: z.array(z.unknown()), timestamp: timestampSchema }).passthrough()
const RuntimeSnapshotSchema = z.record(z.unknown())
const IdeSnapshotSchema = z.record(z.unknown())
const ToolExecutionEventSchema = z.object({ id: nonEmptyStringSchema }).passthrough()
const ModelConfigSchema = z.object({ model: nonEmptyStringSchema, maxTokens: z.number().int().positive() }).passthrough()

const ModelProfileSchema = z.object({
  id: nonEmptyStringSchema,
  label: z.string(),
  match: z.object({ providerPattern: z.string(), modelPattern: z.string() }),
  reasoningReliability: z.enum(['low', 'medium', 'high']),
  toolDiscipline: z.enum(['low', 'medium', 'high']),
  contextUseDiscipline: z.enum(['low', 'medium', 'high']),
  evidenceStrictness: z.enum(['strict', 'standard', 'relaxed']),
  contractVerbosity: z.enum(['compact', 'normal', 'explicit']),
  requiresCompactActionContracts: z.boolean(),
  defaultPlanDepth: z.enum(['brief', 'normal', 'detailed']),
  maxParallelToolCalls: z.number().int().min(1).max(5),
  requireStepwiseVerification: z.boolean(),
})

export const ContextRequestSchema = z.object({
  sessionId: nonEmptyStringSchema,
  cwd: nonEmptyStringSchema,
  userMessage: z.string(),
  recentMessages: z.array(MessageSchema),
  transcriptAlreadyInModel: z.boolean().optional(),
  carriedContext: CarriedContextMetadataSchema.optional(),
  mode: ContextModeSchema,
  model: nonEmptyStringSchema,
  modelProfile: ModelProfileSchema.optional(),
  tokenBudget: z.number().int().positive().optional(),
  runtime: RuntimeSnapshotSchema,
  ide: IdeSnapshotSchema.optional(),
  createdAt: timestampSchema,
})

export const RawEvidenceSchema = z.object({
  id: nonEmptyStringSchema,
  sessionId: nonEmptyStringSchema,
  cwd: nonEmptyStringSchema,
  sourceProvider: nonEmptyStringSchema,
  kind: EvidenceKindSchema,
  content: z.string(),
  metadata: z.record(z.unknown()),
  capturedAt: timestampSchema,
  hash: nonEmptyStringSchema,
})

export const ContextFactSchema = z.object({
  id: nonEmptyStringSchema,
  kind: ContextFactKindSchema,
  scope: ContextScopeSchema,
  content: nonEmptyStringSchema,
  citations: citedArraySchema,
  confidence: confidenceSchema,
  freshness: ContextFreshnessSchema,
  sourceProvider: nonEmptyStringSchema,
  sessionId: z.string().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  expiresAt: timestampSchema.optional(),
  origin: ContextOriginSchema.optional(),
  tags: stringListSchema.optional(),
  relatedFiles: stringListSchema.optional(),
  relatedSymbols: stringListSchema.optional(),
  relatedTasks: stringListSchema.optional(),
  status: ContextFactStatusSchema.optional(),
  canonicalKey: nonEmptyStringSchema.optional(),
  supersedes: stringListSchema.optional(),
  conflictsWith: stringListSchema.optional(),
  archivedAt: timestampSchema.optional(),
  lifecycleReason: nonEmptyStringSchema.optional(),
}) satisfies z.ZodType<ContextFact>

export const ContextSectionSchema = z.object({
  id: nonEmptyStringSchema,
  kind: ContextSectionKindSchema,
  title: nonEmptyStringSchema,
  content: z.string(),
  citations: z.array(ContextCitationSchema),
  priority: z.number().finite(),
  confidence: confidenceSchema,
  freshness: ContextFreshnessSchema,
  sourceProvider: nonEmptyStringSchema,
  tokenEstimate: z.number().int().nonnegative(),
  ownership: ContextOwnershipSchema.optional(),
  expiresAt: timestampSchema.optional(),
})

export const ContextDiagnosticSchema = z.object({
  id: nonEmptyStringSchema,
  level: z.enum(['info', 'warning', 'error']),
  source: nonEmptyStringSchema,
  message: nonEmptyStringSchema,
  citation: ContextCitationSchema.optional(),
  createdAt: timestampSchema,
  visibleInPrimaryUi: z.boolean().optional(),
})

const ContextBundleActorProfileSchema = z.object({
  actor: ContextActorSchema,
  sessionId: nonEmptyStringSchema,
  subSessionId: z.string().optional(),
  teamId: z.string().optional(),
  memberId: z.string().optional(),
  taskId: z.string().optional(),
  objective: z.string(),
})

export const ContextBundleSchema = z.object({
  id: nonEmptyStringSchema,
  sessionId: nonEmptyStringSchema,
  requestHash: nonEmptyStringSchema,
  createdAt: timestampSchema,
  actorProfile: ContextBundleActorProfileSchema.optional(),
  sections: z.array(ContextSectionSchema),
  citations: z.array(ContextCitationSchema),
  diagnostics: z.array(ContextDiagnosticSchema),
  budget: z.object({
    maxTokens: z.number().int().nonnegative().optional(),
    usedTokens: z.number().int().nonnegative(),
    droppedTokens: z.number().int().nonnegative(),
    providerLimitObserved: z.number().int().positive().optional(),
    retryReason: z.string().optional(),
  }),
}) satisfies z.ZodType<ContextBundle>

export const HarvestCandidateSchema = z.object({
  sessionId: nonEmptyStringSchema,
  runLoopId: nonEmptyStringSchema,
  userMessage: z.string(),
  assistantMessages: z.array(MessageSchema),
  toolEvents: z.array(ToolExecutionEventSchema),
  changedFiles: z.array(z.string()),
  createdAt: timestampSchema,
  origin: ContextOriginSchema.partial().optional(),
})

export const HarvestDecisionSchema: z.ZodType<HarvestDecision> = z.discriminatedUnion('action', [
  z.object({ action: z.literal('skip'), reason: SkipReasonSchema }),
  z.object({ action: z.literal('distill_runtime'), reason: nonEmptyStringSchema }),
  z.object({ action: z.literal('distill_conversation'), reason: nonEmptyStringSchema }),
  z.object({ action: z.literal('distill_memory_candidate'), reason: nonEmptyStringSchema }),
  z.object({ action: z.literal('distill_project_update'), reason: nonEmptyStringSchema }),
  z.object({ action: z.literal('distill_team_ledger'), reason: nonEmptyStringSchema }),
  z.object({ action: z.literal('distill_artifact_summary'), reason: nonEmptyStringSchema }),
  z.object({ action: z.literal('distill_qa_issue'), reason: nonEmptyStringSchema }),
  z.object({ action: z.literal('distill_workflow_rule'), reason: nonEmptyStringSchema }),
])

export const HarvestModelBindingSchema = z.object({
  sessionId: nonEmptyStringSchema,
  providerProtocol: ProviderProtocolSchema,
  modelId: nonEmptyStringSchema,
  modelConfig: ModelConfigSchema,
  modelGroupId: nonEmptyStringSchema.optional(),
  baseUrl: nonEmptyStringSchema.optional(),
  contextWindow: z.number().int().positive().optional(),
})

export const HarvestJobSchema = z.object({
  id: nonEmptyStringSchema,
  sessionId: nonEmptyStringSchema,
  runLoopId: nonEmptyStringSchema,
  status: HarvestStatusSchema,
  candidate: HarvestCandidateSchema,
  decision: HarvestDecisionSchema.optional(),
  modelBinding: HarvestModelBindingSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  visibleInPrimaryUi: z.boolean().optional(),
})

export const MemoryRecordSchema = z.object({
  id: nonEmptyStringSchema,
  kind: MemoryRecordKindSchema,
  scope: MemoryScopeSchema,
  content: nonEmptyStringSchema,
  citations: citedArraySchema,
  confidence: confidenceSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  expiresAt: timestampSchema.optional(),
}) satisfies z.ZodType<MemoryRecord>

export const ContextConfigSchema = z.object({
  enabled: z.boolean(),
  injectionEnabled: z.boolean(),
  harvestEnabled: z.boolean(),
  inspectEnabled: z.boolean(),
  providerToggles: z.object(Object.fromEntries(ContextProviderIdSchema.options.map((id) => [id, z.boolean()])) as Record<ContextProviderId, z.ZodBoolean>),
  tokenBudget: z.object({
    maxBundleTokens: z.number().int().positive().optional(),
    maxSectionTokens: z.number().int().positive().optional(),
    maxCodeTokens: z.number().int().positive().optional(),
    providerOverflowPolicy: z.enum(['degrade_and_retry', 'diagnostic_only']),
  }),
  harvest: z.object({
    maxJobsPerSession: z.number().int().nonnegative(),
    maxOutputTokens: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive(),
    minIntervalMs: z.number().int().nonnegative(),
  }),
  retention: z.object({
    bundleSnapshots: z.number().int().nonnegative(),
    rejectedCandidates: z.number().int().nonnegative(),
    rawEvidenceTtlMs: z.number().int().nonnegative(),
  }),
  memory: z.object({
    trustMode: z.enum(['manual_review', 'auto_accept_high_confidence']),
    minConfidence: confidenceSchema,
  }),
  redaction: z.object({
    enabled: z.boolean(),
    mode: z.enum(['strict', 'balanced']),
  }),
}) satisfies z.ZodType<ContextEngineConfig>

const DistillerPayloadSchema = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.unknown()), z.record(z.unknown())])

export const DistillerEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  distiller: nonEmptyStringSchema,
  confidence: confidenceSchema,
  citations: citedArraySchema,
  payload: DistillerPayloadSchema,
}) satisfies z.ZodType<DistillerEnvelope>

export const DistillerSkipOutputSchema = z.object({
  schemaVersion: z.literal(1),
  distiller: nonEmptyStringSchema,
  action: z.literal('skip'),
  reason: SkipReasonSchema,
  confidence: confidenceSchema,
  diagnostic: z.string().optional(),
}) satisfies z.ZodType<DistillerSkipOutput>

export const DistillerBatchOutputSchema = z.object({
  schemaVersion: z.literal(1),
  distiller: nonEmptyStringSchema,
  facts: z.array(DistillerEnvelopeSchema).min(1),
  skipped: z.array(z.object({ reason: SkipReasonSchema, diagnostic: z.string().optional() })).optional(),
}) satisfies z.ZodType<DistillerBatchOutput>

export const DistillerOutputSchema = z.union([DistillerEnvelopeSchema, DistillerSkipOutputSchema, DistillerBatchOutputSchema]) satisfies z.ZodType<DistillerOutput>

export const RuntimeNarrativePayloadSchema = z.object({ summary: nonEmptyStringSchema, rootCause: z.string().optional(), affectedTools: z.array(z.string()), followUpRecommended: z.boolean() })
export const ConversationStatePayloadSchema = z.object({ currentGoal: nonEmptyStringSchema, activeConstraints: z.array(z.string()), confirmedDecisions: z.array(z.string()), rejectedDirections: z.array(z.string()), openQuestions: z.array(z.string()) })
export const MemoryCandidatePayloadSchema = z.object({ kind: MemoryRecordKindSchema, scope: MemoryScopeSchema, content: nonEmptyStringSchema, confidence: confidenceSchema, expiresAt: timestampSchema.optional() })
export const ProjectProfilePayloadSchema = z.object({ projectPurpose: nonEmptyStringSchema, packageBoundaries: z.array(z.object({ name: nonEmptyStringSchema, path: nonEmptyStringSchema, responsibility: nonEmptyStringSchema })), commands: z.array(z.object({ name: nonEmptyStringSchema, command: nonEmptyStringSchema, purpose: nonEmptyStringSchema })), architectureNotes: z.array(z.string()) })
export const CodeTaskPayloadSchema = z.object({ relevantSymbols: z.array(z.object({ name: nonEmptyStringSchema, file: nonEmptyStringSchema, line: z.number().int().positive().optional(), reason: nonEmptyStringSchema })), relevantFiles: z.array(z.object({ file: nonEmptyStringSchema, reason: nonEmptyStringSchema })), suggestedTools: z.array(z.object({ tool: nonEmptyStringSchema, input: z.record(z.unknown()), reason: nonEmptyStringSchema })) })
export const TeamLedgerPayloadSchema = z.object({
  kind: z.enum(['team_decision', 'task_result']),
  summary: nonEmptyStringSchema,
  teamId: nonEmptyStringSchema,
  taskId: z.string().optional(),
  memberId: z.string().optional(),
  confidence: confidenceSchema.optional(),
})
export const ArtifactSummaryPayloadSchema = z.object({
  artifactId: nonEmptyStringSchema,
  summary: nonEmptyStringSchema,
  artifactType: z.string().optional(),
  teamId: nonEmptyStringSchema,
  taskId: nonEmptyStringSchema.optional(),
  memberId: nonEmptyStringSchema.optional(),
  confidence: confidenceSchema.optional(),
})
export const QaIssuePayloadSchema = z.object({
  issueId: nonEmptyStringSchema,
  title: nonEmptyStringSchema,
  status: z.enum(['open', 'in_progress', 'resolved', 'wontfix']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  summary: nonEmptyStringSchema,
  teamId: nonEmptyStringSchema,
  taskId: nonEmptyStringSchema.optional(),
  confidence: confidenceSchema.optional(),
})
export const WorkflowRulePayloadSchema = z.object({
  content: nonEmptyStringSchema,
  workflowType: z.enum(['release', 'build', 'test', 'package', 'ci']),
  commands: z.array(nonEmptyStringSchema),
  files: z.array(nonEmptyStringSchema),
  confidence: confidenceSchema.optional(),
})

export function validateContextFact(input: unknown) { return ContextFactSchema.safeParse(input) }
export function validateContextBundle(input: unknown) { return ContextBundleSchema.safeParse(input) }
export function validateMemoryRecord(input: unknown) { return MemoryRecordSchema.safeParse(input) }
export function validateDistillerEnvelope(input: unknown) { return DistillerEnvelopeSchema.safeParse(input) }
export function validateDistillerOutput(input: unknown) { return DistillerOutputSchema.safeParse(input) }
