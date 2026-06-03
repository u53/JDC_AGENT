import type { Message, ModelConfig } from '../types.js'

export type ContextMode = 'chat' | 'debug' | 'code_edit' | 'review' | 'plan'
export type ContextPlanIntent = 'chat' | 'debug' | 'code_edit' | 'review' | 'plan' | 'memory_update'
export type ContextFreshness = 'live' | 'recent' | 'cached' | 'stale'
export type ContextScope = 'global' | 'project' | 'repo' | 'session' | 'turn'
export type EvidenceKind = 'file' | 'git' | 'tool_event' | 'message' | 'memory' | 'ide' | 'config' | 'task' | 'diagnostic'
export type ContextFactKind = 'project_profile' | 'architecture_decision' | 'module_boundary' | 'user_preference' | 'current_goal' | 'runtime_error_chain' | 'code_entrypoint' | 'known_issue' | 'project_convention' | 'workflow_rule' | 'team_decision' | 'task_result' | 'artifact_summary' | 'qa_issue'
export const AUTO_ACCEPT_CONTEXT_FACT_KINDS = ['project_profile', 'architecture_decision', 'module_boundary', 'project_convention', 'workflow_rule', 'code_entrypoint', 'runtime_error_chain', 'team_decision', 'task_result', 'artifact_summary', 'qa_issue'] as const satisfies readonly ContextFactKind[]
export type AutoAcceptContextFactKind = typeof AUTO_ACCEPT_CONTEXT_FACT_KINDS[number]
export type ContextSectionKind = 'user_intent' | 'project_profile' | 'code_map' | 'relevant_code' | 'git_state' | 'memory' | 'conversation_state' | 'runtime_state' | 'ide_state' | 'diagnostics'
export type SkipReason = 'greeting_or_smalltalk' | 'no_new_fact' | 'too_short' | 'duplicate_of_existing_context' | 'low_confidence' | 'sensitive_content' | 'rate_limited' | 'model_noop' | 'cancelled' | 'timeout'
export type HarvestStatus = 'queued' | 'classified' | 'distilling' | 'validating' | 'accepted' | 'pending_review' | 'rejected' | 'skipped' | 'failed'
export type ProviderProtocol = 'anthropic' | 'openai-chat' | 'openai-responses'
export type ContextActor = 'main_session' | 'subagent' | 'team_pm' | 'team_worker' | 'system' | 'user'
export type MemoryTrustMode = 'manual_review' | 'auto_accept_high_confidence'
export type MemoryRecordKind = 'user_preference' | 'project_convention' | 'architecture_decision' | 'known_issue' | 'workflow_hint'
export type ContextProviderId = 'code' | 'project' | 'git' | 'conversation' | 'memory' | 'runtime' | 'ide'
export type ContextProviderStatus = 'enabled' | 'disabled' | 'fresh' | 'cached' | 'stale' | 'not_indexed' | 'indexing' | 'timeout' | 'failed' | 'rate_limited'

export interface ContextOrigin {
  projectKey: string
  actor: ContextActor
  sessionId?: string
  runLoopId?: string
  subSessionId?: string
  teamId?: string
  memberId?: string
  taskId?: string
  artifactId?: string
  toolUseId?: string
  messageId?: string
  providerProtocol?: ProviderProtocol
  modelId?: string
}

export interface ActorContextProfile {
  actor: ContextActor
  sessionId: string
  cwd: string
  mode: ContextMode
  objective: string
  subSessionId?: string
  teamId?: string
  memberId?: string
  taskId?: string
  fileScope?: string[]
  preferredFactCount?: number
  explicitTokenCap?: number
  explicitCodeTokenCap?: number
  includeTeamState: boolean
  includeWorkerLogs: false
}

export interface RuntimeSnapshot { [key: string]: unknown }
export interface IdeSnapshot { [key: string]: unknown }
export interface ToolExecutionEvent { id: string; name?: string; status?: string; [key: string]: unknown }
export type ContextProviderOverflowPolicy = 'degrade_and_retry' | 'diagnostic_only'
export interface ContextTokenBudget { maxTokens?: number; usedTokens: number; droppedTokens: number; providerLimitObserved?: number; retryReason?: string }
export interface ContextTokenCost { tokenEstimate: number; source?: string; actualTokens?: number; droppedTokens?: number }

export interface ContextCitation {
  id: string
  type: EvidenceKind
  ref: string
  line?: number
  range?: [number, number]
  timestamp?: number
  hash?: string
}

export interface ContextRequest {
  sessionId: string
  cwd: string
  userMessage: string
  recentMessages: Message[]
  mode: ContextMode
  model: string
  tokenBudget?: number
  runtime: RuntimeSnapshot
  ide?: IdeSnapshot
  signal?: AbortSignal
  createdAt: number
}

export interface RawEvidence {
  id: string
  sessionId: string
  cwd: string
  sourceProvider: string
  kind: EvidenceKind
  content: string
  metadata: Record<string, unknown>
  capturedAt: number
  hash: string
}

export interface ContextFact {
  id: string
  kind: ContextFactKind
  scope: ContextScope
  content: string
  citations: ContextCitation[]
  confidence: number
  freshness: ContextFreshness
  sourceProvider: string
  sessionId?: string
  createdAt: number
  updatedAt: number
  expiresAt?: number
  origin?: ContextOrigin
  tags?: string[]
  relatedFiles?: string[]
  relatedSymbols?: string[]
  relatedTasks?: string[]
}

export type ContextItem = ContextFact

export interface ContextSection {
  id: string
  kind: ContextSectionKind
  title: string
  content: string
  citations: ContextCitation[]
  priority: number
  confidence: number
  freshness: ContextFreshness
  sourceProvider: string
  tokenEstimate: number
  expiresAt?: number
}

export interface ContextDiagnostic {
  id: string
  level: 'info' | 'warning' | 'error'
  source: string
  message: string
  citation?: ContextCitation
  createdAt: number
  visibleInPrimaryUi?: boolean
}

export interface ContextPlan {
  id: string
  requestHash: string
  intent: ContextPlanIntent
  objective: string
  relevantSections: string[]
  suppressedSections: Array<{ id: string; reason: string }>
  missingEvidence: Array<{ kind: string; reason: string }>
  diagnostics: ContextDiagnostic[]
}

export interface ContextBundle {
  id: string
  sessionId: string
  requestHash: string
  createdAt: number
  actorProfile?: Pick<ActorContextProfile, 'actor' | 'sessionId' | 'subSessionId' | 'teamId' | 'memberId' | 'taskId' | 'objective'>
  sections: ContextSection[]
  citations: ContextCitation[]
  diagnostics: ContextDiagnostic[]
  budget: ContextTokenBudget
}

export interface HarvestCandidate {
  sessionId: string
  runLoopId: string
  userMessage: string
  assistantMessages: Message[]
  toolEvents: ToolExecutionEvent[]
  changedFiles: string[]
  createdAt: number
  origin?: Partial<ContextOrigin>
}

export type HarvestDecision =
  | { action: 'skip'; reason: SkipReason }
  | { action: 'distill_runtime'; reason: string }
  | { action: 'distill_conversation'; reason: string }
  | { action: 'distill_memory_candidate'; reason: string }
  | { action: 'distill_project_update'; reason: string }
  | { action: 'distill_team_ledger'; reason: string }
  | { action: 'distill_artifact_summary'; reason: string }
  | { action: 'distill_qa_issue'; reason: string }

export interface HarvestModelBinding {
  sessionId: string
  providerProtocol: ProviderProtocol
  modelId: string
  modelConfig: ModelConfig
  modelGroupId?: string
  baseUrl?: string
  contextWindow?: number
}

export interface HarvestJob {
  id: string
  sessionId: string
  runLoopId: string
  status: HarvestStatus
  candidate: HarvestCandidate
  decision?: HarvestDecision
  modelBinding: HarvestModelBinding
  createdAt: number
  updatedAt: number
  visibleInPrimaryUi?: boolean
}

export interface ReasoningCapturePolicy {
  captureRawThinking: false
  captureReasoningSummary: 'never' | 'ephemeral_diagnostics'
  allowAsCitation: false
  allowAsMemorySource: false
}

export const DEFAULT_REASONING_CAPTURE_POLICY: ReasoningCapturePolicy = {
  captureRawThinking: false,
  captureReasoningSummary: 'ephemeral_diagnostics',
  allowAsCitation: false,
  allowAsMemorySource: false,
}

export interface DistillerEnvelope<T = unknown> {
  schemaVersion: 1
  distiller: string
  confidence: number
  citations: ContextCitation[]
  payload: T
}

export interface DistillerSkipOutput {
  schemaVersion: 1
  distiller: string
  action: 'skip'
  reason: SkipReason
  confidence: number
  diagnostic?: string
}

export type DistillerOutput<T = unknown> = DistillerEnvelope<T> | DistillerSkipOutput

export interface RuntimeNarrativePayload {
  summary: string
  rootCause?: string
  affectedTools: string[]
  followUpRecommended: boolean
}

export interface ConversationStatePayload {
  currentGoal: string
  activeConstraints: string[]
  confirmedDecisions: string[]
  rejectedDirections: string[]
  openQuestions: string[]
}

export interface MemoryCandidatePayload {
  kind: MemoryRecordKind
  scope: Exclude<ContextScope, 'turn'>
  content: string
  confidence: number
  expiresAt?: number
}

export interface ProjectProfilePayload {
  projectPurpose: string
  packageBoundaries: Array<{ name: string; path: string; responsibility: string }>
  commands: Array<{ name: string; command: string; purpose: string }>
  architectureNotes: string[]
}

export interface CodeTaskPayload {
  relevantSymbols: Array<{ name: string; file: string; line?: number; reason: string }>
  relevantFiles: Array<{ file: string; reason: string }>
  suggestedTools: Array<{ tool: string; input: Record<string, unknown>; reason: string }>
}

export interface MemoryRecord {
  id: string
  kind: MemoryRecordKind
  scope: Exclude<ContextScope, 'turn'>
  content: string
  citations: ContextCitation[]
  confidence: number
  createdAt: number
  updatedAt: number
  expiresAt?: number
}

export interface ContextEngineConfig {
  enabled: boolean
  injectionEnabled: boolean
  harvestEnabled: boolean
  inspectEnabled: boolean
  providerToggles: Record<ContextProviderId, boolean>
  // Optional legacy/debug overrides only. Production Engine paths must not
  // default these values because context selection is relevance-based, not
  // governed by a local bundle/section/code token ceiling.
  tokenBudget: {
    maxBundleTokens?: number
    maxSectionTokens?: number
    maxCodeTokens?: number
    providerOverflowPolicy: ContextProviderOverflowPolicy
  }
  harvest: {
    maxJobsPerSession: number
    maxOutputTokens: number
    timeoutMs: number
    minIntervalMs: number
  }
  performance?: {
    providerTimeoutMs: number
    degradedProviderTimeoutMs: number
    maxBackgroundJobsPerProject: number
    harvestMinIntervalMs: number
    contextPanelMaxRows: number
  }
  retention: {
    bundleSnapshots: number
    rejectedCandidates: number
    rawEvidenceTtlMs: number
  }
  memory: {
    trustMode: MemoryTrustMode
    minConfidence: number
  }
  redaction: {
    enabled: boolean
    mode: 'strict' | 'balanced'
  }
}

export interface ProviderHealth {
  id: ContextProviderId
  status: ContextProviderStatus
  updatedAt: number
  diagnostic?: ContextDiagnostic
  progress?: { scanned: number; total: number; fromSnapshot?: boolean }
  backgroundJob?: { id: string; status: 'queued' | 'running' | 'completed' | 'failed'; startedAt?: number; completedAt?: number; cancelable?: boolean }
}
