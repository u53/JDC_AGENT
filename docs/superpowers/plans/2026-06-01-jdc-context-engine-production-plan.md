# JDC Context Engine Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the production-grade JDC Context Engine described in `docs/superpowers/specs/2026-06-01-jdc-context-engine-production-design.md`.

**Architecture:** JDC Context Engine is a JDC-native context orchestration layer. It collects deterministic evidence, distills semantic context with the current session model, validates AI output with schema/citations, stores accepted facts, and renders per-turn `ContextBundle`s without breaking existing tools.

**Tech Stack:** TypeScript, existing core session/runtime architecture, existing model providers, existing JDC code engine, sql.js/history patterns, Electron IPC, React UI, Vitest.

---

## Team Shape

Recommended team:

- Core Lead: owns architecture consistency, runtime integration, provider boundaries.
- Context Store Engineer: owns schema, persistence, invalidation, quotas.
- Distillation Engineer: owns harvest jobs, AI schemas, validation, current-session model binding.
- Runtime Engineer: owns runLoop integration, tool-event ledger, fallback behavior.
- Frontend Engineer: owns ContextInspect, Harvest Queue, Memory Review, Provider Health.
- Evals/QA Engineer: owns regression tests, context evals, fixture projects, safety checks.

## Non-Negotiable Constraints

- The name is `JDC Context Engine`.
- Existing `Jdc*` code tools stay available.
- Existing model protocols remain supported: Anthropic Messages, OpenAI Chat Completions, OpenAI Responses.
- Async harvest uses the current session model binding captured at runLoop completion.
- Raw model thinking/reasoning is not durable context and is not citation evidence.
- Context generation cannot block or break normal chat.
- Provider/distiller/store failures must fall back to current behavior.
- No AI-generated fact becomes durable without schema validation and citations.
- The UI must include an inspection path so context bugs are debuggable.

## File Boundary Map

Create:

- `packages/core/src/context/types.ts`
- `packages/core/src/context/orchestrator.ts`
- `packages/core/src/context/budgeter.ts`
- `packages/core/src/context/ranker.ts`
- `packages/core/src/context/citations.ts`
- `packages/core/src/context/prompt-renderer.ts`
- `packages/core/src/context/diagnostics.ts`
- `packages/core/src/context/store.ts`
- `packages/core/src/context/harvest.ts`
- `packages/core/src/context/model-binding.ts`
- `packages/core/src/context/reasoning-policy.ts`
- `packages/core/src/context/config.ts`
- `packages/core/src/context/providers/code-provider.ts`
- `packages/core/src/context/providers/project-provider.ts`
- `packages/core/src/context/providers/git-provider.ts`
- `packages/core/src/context/providers/conversation-provider.ts`
- `packages/core/src/context/providers/memory-provider.ts`
- `packages/core/src/context/providers/runtime-provider.ts`
- `packages/core/src/context/providers/ide-provider.ts`
- `packages/core/src/context/distillers/project-profile-distiller.ts`
- `packages/core/src/context/distillers/conversation-state-distiller.ts`
- `packages/core/src/context/distillers/runtime-narrative-distiller.ts`
- `packages/core/src/context/distillers/memory-curator-distiller.ts`
- `packages/core/src/context/distillers/code-task-distiller.ts`
- `packages/core/src/tools/context-inspect.ts`
- `packages/core/src/tools/context-refresh.ts`
- `packages/core/src/tools/memory-search.ts`
- `packages/core/src/tools/memory-write.ts`
- `packages/ui/src/components/context/ContextInspectPanel.tsx`
- `packages/ui/src/components/context/HarvestQueuePanel.tsx`
- `packages/ui/src/components/context/MemoryReviewPanel.tsx`
- `packages/ui/src/components/context/ProviderHealthPanel.tsx`
- `packages/ui/src/stores/context-store.ts`
- `packages/core/tests/context-engine-production/*.test.ts`

Modify:

- `packages/core/src/session.ts`
- `packages/core/src/sub-session.ts`
- `packages/core/src/tools/index.ts`
- `packages/core/src/index.ts`
- `packages/electron/src/session-manager.ts`
- `packages/electron/src/ipc-channels.ts`
- `packages/electron/src/ipc-handlers.ts`
- `packages/electron/src/preload.ts`
- `packages/ui/src/lib/ipc-client.ts`
- `packages/ui/src/components/SettingsOverlay.tsx`
- `packages/ui/src/stores/settings-store.ts`
- `packages/ui/src/components/Inspector.tsx`
- `packages/ui/src/components/tool-cards/tool-card-meta.ts`
- `packages/ui/src/components/tool-cards/ToolCardRouter.tsx`

## Task A: Core Context Protocol

**Owner:** Core Lead

**Files:**

- Create: `packages/core/src/context/types.ts`
- Create: `packages/core/src/context/citations.ts`
- Test: `packages/core/tests/context-engine-production/types.test.ts`

**Deliverable:** Shared type system for all context components.

**Required definitions:**

- `ContextRequest`
- `RawEvidence`
- `ContextFact`
- `ContextCitation`
- `ContextSection`
- `ContextBundle`
- `ContextDiagnostic`
- `HarvestCandidate`
- `HarvestDecision`
- `HarvestModelBinding`
- `ReasoningCapturePolicy`

**Acceptance:**

- All context records carry source/citation/freshness/confidence.
- Type definitions compile without depending on UI code.
- Tests cover citation validation and harvest skip reasons.

## Task B: JDC Context Store

**Owner:** Context Store Engineer

**Files:**

- Create: `packages/core/src/context/store.ts`
- Create: `packages/core/src/context/diagnostics.ts`
- Test: `packages/core/tests/context-engine-production/store.test.ts`

**Deliverable:** Local persistence and query API for raw evidence, facts, bundle snapshots, rejected candidates, and diagnostics.

**Required API:**

- `saveRawEvidence(evidence)`
- `saveFact(fact)`
- `rejectCandidate(candidate, reason)`
- `saveBundleSnapshot(bundle)`
- `queryFacts(request)`
- `invalidateByFileHash(filePath, hash)`
- `enforceQuotas()`

**Acceptance:**

- Store can query by scope, freshness, confidence, and citation.
- Rejected candidates have short retention.
- ContextBundle snapshots are ring-buffered.
- Quotas prevent unbounded growth.

## Task C: Deterministic Signal Producers

**Owner:** Core Lead + Runtime Engineer

**Files:**

- Create: `packages/core/src/context/providers/code-provider.ts`
- Create: `packages/core/src/context/providers/project-provider.ts`
- Create: `packages/core/src/context/providers/git-provider.ts`
- Create: `packages/core/src/context/providers/conversation-provider.ts`
- Create: `packages/core/src/context/providers/memory-provider.ts`
- Create: `packages/core/src/context/providers/runtime-provider.ts`
- Create: `packages/core/src/context/providers/ide-provider.ts`
- Test: `packages/core/tests/context-engine-production/providers.test.ts`

**Deliverable:** Providers that collect raw evidence and cheap live context without AI.

**Acceptance:**

- Providers never mutate files.
- Providers return diagnostics instead of throwing fatal errors.
- Code provider wraps existing JDC code engine.
- Runtime provider captures tool errors and sibling cancellation chains.
- Conversation provider identifies current user intent and recent decisions from already-loaded messages.

## Task D: Model Binding and Protocol Safety

**Owner:** Distillation Engineer

**Files:**

- Create: `packages/core/src/context/model-binding.ts`
- Create: `packages/core/src/context/reasoning-policy.ts`
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/sub-session.ts`
- Test: `packages/core/tests/context-engine-production/model-binding.test.ts`

**Deliverable:** Harvest jobs capture and use the current session model/provider/protocol.

**Acceptance:**

- Binding records Anthropic/OpenAI Chat/OpenAI Responses.
- Binding captures model id, model config, model group, base URL, and context window.
- Harvest jobs do not use default/global models unless explicitly configured.
- Raw thinking/reasoning is excluded from durable facts.
- Reasoning summaries are at most ephemeral diagnostics.

## Task E: AI Distillation Layer

**Owner:** Distillation Engineer

**Files:**

- Create: `packages/core/src/context/harvest.ts`
- Create: `packages/core/src/context/distillers/project-profile-distiller.ts`
- Create: `packages/core/src/context/distillers/conversation-state-distiller.ts`
- Create: `packages/core/src/context/distillers/runtime-narrative-distiller.ts`
- Create: `packages/core/src/context/distillers/memory-curator-distiller.ts`
- Create: `packages/core/src/context/distillers/code-task-distiller.ts`
- Test: `packages/core/tests/context-engine-production/harvest.test.ts`
- Test: `packages/core/tests/context-engine-production/distillers.test.ts`

**Deliverable:** Async harvest pipeline that produces structured candidates only when a runLoop contains durable value.

**Acceptance:**

- Greeting/smalltalk turns are skipped.
- Short acknowledgement turns are skipped.
- Tool error chains can produce runtime facts.
- User-confirmed preferences can produce memory candidates.
- Distiller output must validate against schema.
- Candidates without citations are rejected.
- Low-confidence candidates are rejected or stored only as diagnostics.

## Task F: Context Orchestrator and Synthesizer

**Owner:** Core Lead

**Files:**

- Create: `packages/core/src/context/orchestrator.ts`
- Create: `packages/core/src/context/budgeter.ts`
- Create: `packages/core/src/context/ranker.ts`
- Create: `packages/core/src/context/prompt-renderer.ts`
- Test: `packages/core/tests/context-engine-production/orchestrator.test.ts`
- Test: `packages/core/tests/context-engine-production/prompt-renderer.test.ts`

**Deliverable:** Per-turn `ContextBundle` construction under a token budget.

**Acceptance:**

- Latest user message outranks all stored context.
- Live runtime state outranks cached summaries.
- IDE selection outranks stale project memory.
- Sections are deduplicated by citation and content hash.
- Provider errors appear in diagnostics.
- Rendered prompt is protocol-neutral before provider adapter formatting.
- Bundle generation has a fallback path that returns an empty bundle with diagnostics.

## Task G: Runtime Integration

**Owner:** Runtime Engineer

**Files:**

- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/sub-session.ts`
- Modify: `packages/electron/src/session-manager.ts`
- Test: `packages/core/tests/context-engine-production/runtime-integration.test.ts`

**Deliverable:** Foreground runLoop uses context bundles; completed runLoops enqueue harvest candidates.

**Acceptance:**

- Context bundle is built before model streaming.
- Context bundle can be disabled by config.
- Harvest candidate is created after runLoop completion.
- Harvest job does not block foreground chat.
- Tool errors are written to runtime ledger.
- Abort/cancel events are represented accurately.

## Task H: Context Tools

**Owner:** Core Lead

**Files:**

- Create: `packages/core/src/tools/context-inspect.ts`
- Create: `packages/core/src/tools/context-refresh.ts`
- Create: `packages/core/src/tools/memory-search.ts`
- Create: `packages/core/src/tools/memory-write.ts`
- Modify: `packages/core/src/tools/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/context-engine-production/context-tools.test.ts`

**Deliverable:** Small tool surface for inspection, refresh, and structured memory operations.

**Acceptance:**

- `JdcContextInspect` returns final bundle, dropped sections, diagnostics, token budget, provider timings, citations.
- `JdcContextRefresh` refreshes selected providers without file mutation.
- `JdcMemorySearch` searches accepted memory records by scope and query.
- `JdcMemoryWrite` requires citation, scope, kind, and confidence.

## Task I: Electron IPC and UI Store

**Owner:** Frontend Engineer

**Files:**

- Modify: `packages/electron/src/ipc-channels.ts`
- Modify: `packages/electron/src/ipc-handlers.ts`
- Modify: `packages/electron/src/preload.ts`
- Modify: `packages/ui/src/lib/ipc-client.ts`
- Create: `packages/ui/src/stores/context-store.ts`
- Test: `packages/ui/src/stores/context-store.test.ts`

**Deliverable:** UI can read context bundle snapshots, harvest queue, memory review items, and provider health.

**Acceptance:**

- IPC exposes context inspect data for active session.
- IPC exposes provider health.
- IPC exposes harvest queue state.
- IPC exposes memory review records.
- Store handles loading, refresh, and error states.

## Task J: Frontend Context Panels

**Owner:** Frontend Engineer

**Files:**

- Create: `packages/ui/src/components/context/ContextInspectPanel.tsx`
- Create: `packages/ui/src/components/context/HarvestQueuePanel.tsx`
- Create: `packages/ui/src/components/context/MemoryReviewPanel.tsx`
- Create: `packages/ui/src/components/context/ProviderHealthPanel.tsx`
- Modify: `packages/ui/src/components/Inspector.tsx`
- Modify: `packages/ui/src/components/tool-cards/tool-card-meta.ts`
- Modify: `packages/ui/src/components/tool-cards/ToolCardRouter.tsx`
- Test: `packages/ui/src/components/context/ContextInspectPanel.test.tsx`

**Deliverable:** Debuggable but quiet UI for production context behavior.

**Acceptance:**

- Normal chat UI remains unchanged by default.
- Inspector exposes context tabs.
- Bundle view shows sections, citations, confidence, freshness, and token cost.
- Harvest Queue shows skipped/accepted/rejected jobs.
- Memory Review shows candidates and rejection reasons.
- Provider Health shows enabled/stale/failed/rate-limited providers.

## Task K: Security, Redaction, and Data Policy

**Owner:** Evals/QA Engineer + Core Lead

**Files:**

- Create: `packages/core/src/context/redaction.ts`
- Modify: `packages/core/src/context/harvest.ts`
- Modify: `packages/core/src/context/store.ts`
- Test: `packages/core/tests/context-engine-production/redaction.test.ts`

**Deliverable:** Secrets and sensitive files are not stored or distilled.

**Acceptance:**

- `.env`, private keys, tokens, credential stores are redacted.
- Sensitive raw evidence cannot become memory.
- Redaction happens before distillation.
- ContextInspect marks redacted sections without revealing secrets.

## Task L: Evaluation Harness

**Owner:** Evals/QA Engineer

**Files:**

- Create: `packages/core/tests/context-engine-production/fixtures/`
- Create: `packages/core/tests/context-engine-production/eval-runner.test.ts`
- Create: `packages/core/src/context/evals/assertions.ts`

**Deliverable:** Repeatable evals for context quality.

**Acceptance:**

- Eval covers relevant file recall.
- Eval covers stale memory rejection.
- Eval covers greeting harvest skip.
- Eval covers runtime error chain explanation.
- Eval covers token budget enforcement.
- Eval covers three protocol model bindings.
- Eval covers no raw thinking persistence.

## Task M: Configuration, Feature Flags, and Schema Versioning

**Owner:** Core Lead + Frontend Engineer

**Files:**

- Create: `packages/core/src/context/config.ts`
- Modify: `packages/core/src/config.ts`
- Modify: `packages/ui/src/components/SettingsOverlay.tsx`
- Modify: `packages/ui/src/stores/settings-store.ts`
- Test: `packages/core/tests/context-engine-production/config.test.ts`

**Deliverable:** Safe operational controls for enabling, disabling, tuning, and migrating JDC Context Engine.

**Required config:**

- global enable/disable;
- per-session enable/disable;
- provider toggles;
- harvest enable/disable;
- memory trust mode;
- context token budget;
- max harvest jobs per session;
- store schema version;
- context bundle snapshot retention;
- redaction mode.

**Acceptance:**

- Context injection can be disabled without disabling existing tools.
- Harvest can be disabled while ContextInspect still works.
- Provider toggles persist.
- Store schema version mismatch triggers safe rebuild or migration.
- UI exposes safe controls without cluttering normal chat.

## Cross-Task Acceptance

The whole feature is not production-ready unless:

- Existing JDC tools still work.
- Existing three model protocols still work.
- Context can be disabled.
- Harvest can be disabled.
- UI inspect data is available.
- Provider failure does not block runLoop.
- Distiller failure does not block runLoop.
- Store failure falls back safely.
- No durable fact lacks citation.
- No raw thinking is stored as memory.
- Tests pass for core context package, session runtime, context tools, and UI store.

## Developer Notes for Team Execution

Each task should be developed with tests first. Keep commits scoped to one task. Do not combine frontend panels with core store work. Do not modify existing JDC code tools except where integration requires registration or inspection metadata. Preserve current behavior behind config toggles until the context engine can prove it improves outcomes in evals.
