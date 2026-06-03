# JDC Context Engine Engineering Contract

This document is the implementation contract for JDC Context Engine. It is stricter than the production design and implementation plan. Engineers must treat the types, state machines, failure rules, and default configs here as binding unless the PM explicitly approves a contract change.

## Contract Status

- Product name: `JDC Context Engine`
- Scope: production-grade context orchestration for JDCAGNET
- Runtime: local desktop agent runtime
- Protocols: Anthropic Messages, OpenAI Chat Completions, OpenAI Responses
- Primary language: TypeScript
- Testing: Vitest
- Storage: project-local sql.js-backed context database under the active project's `.jdcagnet` directory

## Non-Negotiables

- Do not rename JDC Context Engine.
- Do not describe it as a generic provider framework.
- Do not break existing `Jdc*` code tools.
- Do not store raw thinking/reasoning as memory.
- Do not accept AI-generated durable facts without citations.
- Do not run expensive harvest on every user message.
- Do not block foreground chat on harvest.
- Do not let context failures fail the runLoop.
- Do not use a global/default model for harvest unless explicitly configured.
- Do not inject uncited durable facts into model prompts.
- Do not expose secrets in context bundles, inspect panels, memory, or logs.
- Do not isolate accepted durable facts by session; `sessionId` is provenance only.
- Do not show rejected, skipped, failed, timeout, aborted, or model no-op rows in the primary context UI.
- Do not require users to manually refresh or rebuild context for normal chat to improve.

## File Ownership Contract

Core context package:

```text
packages/core/src/context/
  types.ts
  schemas.ts
  config.ts
  orchestrator.ts
  store.ts
  harvest.ts
  model-binding.ts
  reasoning-policy.ts
  redaction.ts
  citations.ts
  diagnostics.ts
  budgeter.ts
  ranker.ts
  prompt-renderer.ts
```

Provider package:

```text
packages/core/src/context/providers/
  code-provider.ts
  project-provider.ts
  git-provider.ts
  conversation-provider.ts
  memory-provider.ts
  runtime-provider.ts
  ide-provider.ts
```

Distiller package:

```text
packages/core/src/context/distillers/
  project-profile-distiller.ts
  conversation-state-distiller.ts
  runtime-narrative-distiller.ts
  memory-curator-distiller.ts
  code-task-distiller.ts
```

Tool package:

```text
packages/core/src/tools/context-inspect.ts
packages/core/src/tools/context-refresh.ts
packages/core/src/tools/memory-search.ts
packages/core/src/tools/memory-write.ts
```

UI package:

```text
packages/ui/src/components/context/
  ContextPanel.tsx
  ContextPanelLayout.tsx
  ContextPanelPrimitives.tsx
  ContextFactsPanel.tsx
  ContextCurrentPanel.tsx
  ContextAdvancedDiagnosticsPanel.tsx
  ContextInspectPanel.tsx
  HarvestQueuePanel.tsx
  MemoryReviewPanel.tsx
  ProviderHealthPanel.tsx

packages/ui/src/stores/context-store.ts
```

No task may move these files without PM approval.

## Canonical Types

The canonical types live in `packages/core/src/context/types.ts`. UI code may import type definitions from core exports but must not define divergent copies.

```ts
export type ContextMode = 'chat' | 'debug' | 'code_edit' | 'review' | 'plan'

export type ContextFreshness = 'live' | 'recent' | 'cached' | 'stale'

export type ContextScope = 'global' | 'project' | 'repo' | 'session' | 'turn'

export type EvidenceKind =
  | 'file'
  | 'git'
  | 'tool_event'
  | 'message'
  | 'memory'
  | 'ide'
  | 'config'
  | 'task'
  | 'diagnostic'

export type ContextFactKind =
  | 'project_profile'
  | 'architecture_decision'
  | 'module_boundary'
  | 'user_preference'
  | 'current_goal'
  | 'runtime_error_chain'
  | 'code_entrypoint'
  | 'known_issue'
  | 'project_convention'
  | 'workflow_rule'

export type ContextSectionKind =
  | 'user_intent'
  | 'project_profile'
  | 'code_map'
  | 'relevant_code'
  | 'git_state'
  | 'memory'
  | 'conversation_state'
  | 'runtime_state'
  | 'ide_state'
  | 'diagnostics'
```

```ts
export interface ContextCitation {
  id: string
  type: EvidenceKind
  ref: string
  line?: number
  range?: [number, number]
  timestamp?: number
  hash?: string
}
```

```ts
export interface ContextRequest {
  sessionId: string
  cwd: string
  userMessage: string
  recentMessages: Message[]
  mode: ContextMode
  model: string
  tokenBudget: number
  runtime: RuntimeSnapshot
  ide?: IdeSnapshot
  createdAt: number
}
```

```ts
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
```

```ts
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
}
```

```ts
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
```

```ts
export interface ContextDiagnostic {
  id: string
  level: 'info' | 'warning' | 'error'
  source: string
  message: string
  citation?: ContextCitation
  createdAt: number
}
```

```ts
export interface ContextBundle {
  id: string
  sessionId: string
  requestHash: string
  createdAt: number
  sections: ContextSection[]
  citations: ContextCitation[]
  diagnostics: ContextDiagnostic[]
  budget: {
    maxTokens: number
    usedTokens: number
    droppedTokens: number
  }
}
```

## Schema Contract

`packages/core/src/context/schemas.ts` must define Zod schemas for every persisted or IPC-visible shape:

- `ContextCitationSchema`
- `RawEvidenceSchema`
- `ContextFactSchema`
- `ContextSectionSchema`
- `ContextDiagnosticSchema`
- `ContextBundleSchema`
- `HarvestCandidateSchema`
- `HarvestDecisionSchema`
- `HarvestJobSchema`
- `HarvestModelBindingSchema`
- `MemoryRecordSchema`
- `ContextConfigSchema`

Schema parsing must happen at boundaries:

- before accepting distiller output;
- before writing facts/memories;
- before reading persisted bundle snapshots;
- before returning IPC payloads;
- before accepting memory writes from tools.

## Storage Contract

Use a local sql.js-backed database under the active project root. The context store must persist accepted durable facts, bundle snapshots, harvest diagnostics, and provider evidence in the project's `.jdcagnet` directory so same-project sessions share context after app restart.

`sessionId` is provenance, not a persistence partition. Same normalized project root must read the same accepted project/repo/global facts across sessions. Different normalized project roots must not see each other's facts, even when a shared sql.js process registry or explicit `dbPath` is used.

Database file:

```text
<project>/.jdcagnet/context-engine/context.db
```

All persisted rows must be scoped by a normalized `project_key` or an equivalent project identity. IPC and tools must resolve `sessionId -> cwd` before opening a store; default `process.cwd()` stores are forbidden in production context/memory IPC.

Required tables:

```sql
schema_meta(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)

raw_evidence(
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  cwd TEXT NOT NULL,
  source_provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  hash TEXT NOT NULL
)

context_facts(
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  fact_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  content TEXT NOT NULL,
  citations_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  freshness TEXT NOT NULL,
  source_provider TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER
)

context_bundles(
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  bundle_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
)

harvest_jobs(
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  run_loop_id TEXT NOT NULL,
  status TEXT NOT NULL,
  candidate_json TEXT NOT NULL,
  decision_json TEXT,
  model_binding_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)

memory_records(
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  content TEXT NOT NULL,
  citations_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER
)

rejected_candidates(
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  candidate_json TEXT NOT NULL,
  rejection_reason TEXT NOT NULL,
  validation_errors_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  visible_in_primary_ui INTEGER NOT NULL DEFAULT 0
)

context_diagnostics(
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  citation_json TEXT,
  created_at INTEGER NOT NULL
)
```

Required indexes:

```sql
CREATE INDEX idx_raw_evidence_project_session ON raw_evidence(project_key, session_id);
CREATE INDEX idx_raw_evidence_project_cwd ON raw_evidence(project_key, cwd);
CREATE INDEX idx_context_facts_project_scope ON context_facts(project_key, scope);
CREATE INDEX idx_context_facts_project_kind ON context_facts(project_key, kind);
CREATE INDEX idx_context_facts_project_updated ON context_facts(project_key, updated_at);
CREATE INDEX idx_context_bundles_project_session ON context_bundles(project_key, session_id);
CREATE INDEX idx_harvest_jobs_project_session ON harvest_jobs(project_key, session_id);
CREATE INDEX idx_harvest_jobs_project_status ON harvest_jobs(project_key, status);
CREATE INDEX idx_memory_records_project_scope ON memory_records(project_key, scope);
CREATE INDEX idx_rejected_candidates_project_session ON rejected_candidates(project_key, session_id);
CREATE INDEX idx_rejected_candidates_project_status ON rejected_candidates(project_key, status);
```

Schema version key:

```text
schema_meta.key = "context_schema_version"
schema_meta.value = "1"
```

On schema mismatch:

- if migration exists, migrate;
- if migration does not exist, preserve old db as backup and rebuild empty store;
- never crash runLoop.

## Configuration Contract

Default config lives in `packages/core/src/context/config.ts`.

```ts
export interface ContextEngineConfig {
  enabled: boolean
  injectionEnabled: boolean
  harvestEnabled: boolean
  inspectEnabled: boolean
  providerToggles: {
    code: boolean
    project: boolean
    git: boolean
    conversation: boolean
    memory: boolean
    runtime: boolean
    ide: boolean
  }
  tokenBudget: {
    maxBundleTokens: number
    maxSectionTokens: number
    maxCodeTokens: number
  }
  harvest: {
    maxJobsPerSession: number
    maxOutputTokens: number
    timeoutMs: number
    minIntervalMs: number
  }
  performance: {
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
    trustMode: 'manual_review' | 'auto_accept_high_confidence'
    minConfidence: number
  }
  redaction: {
    enabled: boolean
    mode: 'strict' | 'balanced'
  }
}
```

Required defaults:

```ts
export const DEFAULT_CONTEXT_ENGINE_CONFIG: ContextEngineConfig = {
  enabled: true,
  injectionEnabled: true,
  harvestEnabled: true,
  inspectEnabled: true,
  providerToggles: {
    code: true,
    project: true,
    git: true,
    conversation: true,
    memory: true,
    runtime: true,
    ide: true,
  },
  tokenBudget: {
    maxBundleTokens: 2500,
    maxSectionTokens: 700,
    maxCodeTokens: 900,
  },
  harvest: {
    maxJobsPerSession: 50,
    maxOutputTokens: 1200,
    timeoutMs: 30000,
    minIntervalMs: 15000,
  },
  performance: {
    providerTimeoutMs: 120,
    degradedProviderTimeoutMs: 200,
    maxBackgroundJobsPerProject: 1,
    harvestMinIntervalMs: 30000,
    contextPanelMaxRows: 50,
  },
  retention: {
    bundleSnapshots: 50,
    rejectedCandidates: 100,
    rawEvidenceTtlMs: 7 * 24 * 60 * 60 * 1000,
  },
  memory: {
    trustMode: 'auto_accept_high_confidence',
    minConfidence: 0.86,
  },
  redaction: {
    enabled: true,
    mode: 'strict',
  },
}
```

These defaults make the engine automatic by default while keeping foreground work budgeted, background work project-limited, and durable memory acceptance high-confidence and citation-gated.

## Harvest Contract

Harvest is triggered after runLoop completion, never directly on user message receipt.

```ts
export interface HarvestCandidate {
  sessionId: string
  runLoopId: string
  userMessage: string
  assistantMessages: Message[]
  toolEvents: ToolExecutionEvent[]
  changedFiles: string[]
  createdAt: number
}
```

```ts
export type HarvestDecision =
  | { action: 'skip'; reason: SkipReason }
  | { action: 'distill_runtime'; reason: string }
  | { action: 'distill_conversation'; reason: string }
  | { action: 'distill_memory_candidate'; reason: string }
  | { action: 'distill_project_update'; reason: string }
```

Skip reasons:

```ts
export type SkipReason =
  | 'greeting_or_smalltalk'
  | 'no_new_fact'
  | 'too_short'
  | 'duplicate_of_existing_context'
  | 'low_confidence'
  | 'sensitive_content'
  | 'rate_limited'
  | 'model_noop'
  | 'cancelled'
  | 'timeout'
```

Harvest state machine:

```text
queued -> classified -> skipped
queued -> classified -> distilling -> validating -> accepted
queued -> classified -> distilling -> validating -> pending_review
queued -> classified -> distilling -> validating -> rejected
queued -> failed
```

Foreground runLoop must not wait for harvest completion.

Rules:

- harvest is scheduled after a completed runLoop, not on every user message receipt;
- project-level scheduler limits background harvest concurrency and interval;
- cheap routing may skip greetings/no-new-fact turns, but durable storage decisions belong to the model;
- model no-op is a successful quiet skip and must not create accepted facts or primary UI rows;
- timeout/cancelled harvest is a quiet skip/internal diagnostic, not a rejected memory candidate;
- auto-accept is allowed only for high-confidence cited project facts in the allowlisted durable fact kinds.

## Model Binding Contract

Each harvest candidate captures the model binding at the end of the runLoop that produced it.

```ts
export interface HarvestModelBinding {
  sessionId: string
  providerProtocol: 'anthropic' | 'openai-chat' | 'openai-responses'
  modelId: string
  modelConfig: ModelConfig
  modelGroupId?: string
  baseUrl?: string
  contextWindow?: number
}
```

Rules:

- harvest uses the captured binding;
- harvest does not use the active model if the session model changed later;
- harvest does not use hidden fallback models;
- harvest calls have no file tools and no mutation tools;
- harvest output must be JSON and schema-validated.

## Thinking and Reasoning Contract

```ts
export interface ReasoningCapturePolicy {
  captureRawThinking: false
  captureReasoningSummary: 'never' | 'ephemeral_diagnostics'
  allowAsCitation: false
  allowAsMemorySource: false
}
```

Rules:

- raw thinking is discarded for durable context;
- reasoning summary is optional ephemeral diagnostics only;
- durable facts cite user messages, assistant final text, tool events, tool results, files, git state, IDE state, or accepted project docs;
- no feature may depend on a provider exposing reasoning data.

## Distiller Output Contract

All distillers output this envelope:

```ts
export interface DistillerEnvelope<T> {
  schemaVersion: 1
  distiller: string
  confidence: number
  citations: ContextCitation[]
  payload: T
}
```

Distillers may also return a first-class no-op output when the model decides there is no durable project context:

```ts
export interface DistillerSkipOutput {
  schemaVersion: 1
  distiller: string
  action: 'skip'
  reason: 'model_noop'
  confidence: number
  diagnostic?: string
}
```

No-op output is not an error, not a memory candidate, and not primary UI content.

Runtime narrative payload:

```ts
export interface RuntimeNarrativePayload {
  summary: string
  rootCause?: string
  affectedTools: string[]
  followUpRecommended: boolean
}
```

Conversation state payload:

```ts
export interface ConversationStatePayload {
  currentGoal: string
  activeConstraints: string[]
  confirmedDecisions: string[]
  rejectedDirections: string[]
  openQuestions: string[]
}
```

Memory candidate payload:

```ts
export interface MemoryCandidatePayload {
  kind:
    | 'user_preference'
    | 'project_convention'
    | 'architecture_decision'
    | 'known_issue'
    | 'workflow_hint'
  scope: 'global' | 'project' | 'repo' | 'session'
  content: string
  confidence: number
  expiresAt?: number
}
```

Project profile payload:

```ts
export interface ProjectProfilePayload {
  projectPurpose: string
  packageBoundaries: Array<{ name: string; path: string; responsibility: string }>
  commands: Array<{ name: string; command: string; purpose: string }>
  architectureNotes: string[]
}
```

Code task payload:

```ts
export interface CodeTaskPayload {
  relevantSymbols: Array<{ name: string; file: string; line?: number; reason: string }>
  relevantFiles: Array<{ file: string; reason: string }>
  suggestedTools: Array<{ tool: string; input: Record<string, unknown>; reason: string }>
}
```

## Citation Validation Contract

A citation is valid only when:

- file citation points to an existing file or a retained file snapshot;
- message citation points to existing conversation history;
- tool citation points to stored tool event/result;
- git citation points to captured diff/commit evidence;
- memory citation points to accepted memory record;
- citation hash matches when hash is present.

Any durable fact without valid citation is rejected.

## Prompt Rendering Contract

The renderer outputs a protocol-neutral text block. Provider adapters are responsible for Anthropic/OpenAI formatting.

Required root tag:

```xml
<jdc-context-engine bundle="ctx_id">
...
</jdc-context-engine>
```

Required section attributes:

- `kind`
- `confidence`
- `freshness`
- `source`

Example:

```xml
<section kind="runtime_state" confidence="0.91" freshness="live" source="RuntimeProvider">
  Recent tool chain: Read missing file -> read siblings skipped under old policy.
</section>
```

Rules:

- never render secrets;
- mark stale facts;
- mark low-confidence facts;
- include citations compactly;
- stay within token budget;
- latest user message remains outside the context bundle and outranks it.

## IPC Contract

Electron IPC channels:

```ts
context:inspect
context:refresh
context:harvest:list
context:memory:list
context:memory:accept
context:memory:reject
context:providers:health
context:config:get
context:config:update
```

IPC responses must be schema-validated before reaching UI stores.

## Frontend Contract

Context UI is Chinese-first observability under the Inspector. It must read cached project context automatically for the active session, but it must not start renderer-driven refresh/reindex automatically.

Required panels:

- `ContextPanelLayout`
- `ContextFactsPanel`
- `ContextCurrentPanel`
- `ContextAdvancedDiagnosticsPanel`
- `ContextInspectPanel`
- `HarvestQueuePanel`
- `MemoryReviewPanel`
- `ProviderHealthPanel`

Primary tabs:

- `当前状态`
- `项目事实`
- `当前上下文`
- `高级诊断`

Primary UI rules:

- `项目事实` shows accepted durable project/repo/global facts only;
- `当前上下文` shows injected sections and suppressed counts/reasons without rendering suppressed garbage content;
- manual refresh/reindex/read-provider actions live only inside `高级诊断`;
- rejected, pending, skipped, failed, timeout, aborted, and model no-op rows are advanced diagnostics only;
- same-project session switches must reload from project store, not renderer cache;
- partial IPC failures must not clear successful slices from other channels.

Required UI states:

- empty;
- loading;
- loaded;
- provider failed;
- context disabled;
- harvest disabled;
- stale data;
- redacted data;
- validation rejected candidate.

The normal chat surface must not become heavier or require user management by default.

## Failure Matrix

| Failure | Required behavior |
| --- | --- |
| Provider throws | Add diagnostic, continue bundle build |
| Store unavailable | Return empty bundle with diagnostic |
| Distiller invalid JSON | Reject candidate, no durable fact |
| Missing citation | Reject candidate |
| Secret detected | Redact before distillation or reject |
| Harvest timeout/cancel | Quiet skipped/internal diagnostic, foreground unaffected, no rejected memory pollution |
| Model binding missing | Skip harvest, add diagnostic |
| Context render overflow | Drop lowest priority sections |
| Schema mismatch | migrate or rebuild store safely |
| UI IPC fails | show unavailable state, chat unaffected |

## Eval Contract

Required eval cases:

- greeting does not harvest;
- no-new-fact turn does not harvest;
- user preference creates memory candidate only with citation;
- runtime error chain becomes runtime fact;
- stale memory is not injected as live fact;
- wrong model binding fails test;
- raw thinking is not stored;
- provider failure does not block runLoop;
- slow provider returns degraded foreground context within budget;
- accepted project convention is reused across same-project sessions after store reopen;
- model no-op is not rendered as primary durable context;
- context disable fallback works;
- secrets are redacted.

The feature cannot be production-enabled until these evals pass.
