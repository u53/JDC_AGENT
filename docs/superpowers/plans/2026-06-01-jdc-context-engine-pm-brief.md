# PM Brief: JDC Context Engine Team Execution

Copy this brief to the implementation PM. It is intentionally strict.

## Mission

You are the PM for the production-grade JDC Context Engine build.

This is not a generic RAG project, not a provider framework, and not a code-indexing-only feature. JDC Context Engine is a JDC-native context operating system for the agent runtime.

The implementation must follow these documents:

- Design: `docs/superpowers/specs/2026-06-01-jdc-context-engine-production-design.md`
- Plan: `docs/superpowers/plans/2026-06-01-jdc-context-engine-production-plan.md`
- Engineering Contract: `docs/superpowers/specs/2026-06-01-jdc-context-engine-engineering-contract.md`

The Engineering Contract is binding. If a developer wants to change a type, schema, state machine, storage rule, IPC payload, or default config, they must ask the PM first.

## PM Non-Negotiables

- The name is `JDC Context Engine`.
- Do not let anyone rename it to Context Providers, RAG Engine, Memory Engine, or Code Engine.
- Existing `Jdc*` code tools must keep working.
- Existing model protocols must keep working: Anthropic Messages, OpenAI Chat Completions, OpenAI Responses.
- Async harvest must use the current session model binding captured at runLoop completion.
- Raw model thinking/reasoning must not become durable context, memory, or citation evidence.
- Greeting/smalltalk/no-new-fact turns must not create harvest data.
- AI distillation output is only a candidate until schema/citation/confidence validation passes.
- Context failure must never break chat.
- Context injection and harvest must both be feature-flagged.
- Frontend inspectability is mandatory. Invisible context behavior is a production blocker.

## PM Responsibilities

You own task sequencing, dependency enforcement, integration gates, and quality gates.

You must prevent these common failures:

- teams inventing different context types in different files;
- UI building against guessed IPC shapes;
- distillers storing uncited AI summaries;
- harvest using the wrong model;
- context injection being enabled before evals pass;
- memory becoming a garbage dump;
- raw thinking being stored because a provider exposes it;
- context bugs being impossible to inspect.

## Required Team Lanes

Lane 1: Core Protocol

- Owns `packages/core/src/context/types.ts`
- Owns `packages/core/src/context/schemas.ts`
- Owns `packages/core/src/context/citations.ts`
- Must land before other lanes define context types.

Lane 2: Store and Persistence

- Owns `packages/core/src/context/store.ts`
- Owns `packages/core/src/context/diagnostics.ts`
- Owns schema versioning and quotas.

Lane 3: Signal Producers

- Owns `packages/core/src/context/providers/*.ts`
- Must reuse existing JDC code engine, git context, IDE context, memory, and runtime structures.

Lane 4: Harvest and Distillation

- Owns `packages/core/src/context/harvest.ts`
- Owns `packages/core/src/context/distillers/*.ts`
- Owns model binding and no-thinking persistence rules.

Lane 5: Orchestration

- Owns `packages/core/src/context/orchestrator.ts`
- Owns `budgeter.ts`, `ranker.ts`, `prompt-renderer.ts`.
- Must keep rendering protocol-neutral.

Lane 6: Runtime Integration

- Owns integration in `packages/core/src/session.ts`
- Owns integration in `packages/core/src/sub-session.ts`
- Owns harvest enqueue after runLoop completion.

Lane 7: Context Tools

- Owns `packages/core/src/tools/context-inspect.ts`
- Owns `context-refresh.ts`, `memory-search.ts`, `memory-write.ts`.

Lane 8: Frontend and IPC

- Owns Electron IPC changes.
- Owns `packages/ui/src/stores/context-store.ts`.
- Owns `packages/ui/src/components/context/*.tsx`.

Lane 9: Security and Evals

- Owns redaction.
- Owns eval harness.
- Owns production-readiness checks.

## Dependency Rules

No lane may bypass these rules:

- Store work depends on core types.
- Producers depend on core types.
- Harvest depends on core types, store, model binding, and redaction.
- Orchestrator depends on core types, store, and producers.
- Runtime integration depends on orchestrator, model binding, and config.
- Context tools depend on store and orchestrator.
- UI IPC depends on context tools and runtime integration.
- UI panels depend on IPC/store.
- Production enablement depends on evals.

## Integration Gates

Gate A: Type Freeze

Required before broad parallel work:

- `types.ts` complete.
- `schemas.ts` complete.
- citation schema complete.
- no duplicate context interfaces elsewhere.

Gate B: Store Safe

Required before distillers store data:

- schema version exists;
- quota enforcement exists;
- rejected candidates retained temporarily;
- store failure fallback tested.

Gate C: Harvest Safe

Required before async harvest is enabled:

- greeting skip passes;
- no-new-fact skip passes;
- model binding tests pass for all three protocols;
- raw thinking persistence test passes;
- redaction tests pass.

Gate D: Runtime Safe

Required before context injection is enabled:

- context disable fallback works;
- bundle generation failure does not break runLoop;
- harvest job does not block foreground chat;
- ContextInspect can show the injected bundle.

Gate E: UI Inspectable

Required before PM accepts frontend:

- ContextInspect shows sections, citations, confidence, freshness, token cost;
- Harvest Queue shows accepted/skipped/rejected/failed;
- Memory Review shows candidate status and rejection reasons;
- Provider Health shows enabled/stale/failed/rate-limited.

Gate F: Production Candidate

Required before production enablement:

- all context evals pass;
- existing JDC tools pass;
- existing model protocol tests pass;
- full context feature can be disabled;
- no durable fact lacks citation.

## Required Reporting Format

Each task owner must report in this format:

```text
Task:
Files changed:
Tests added:
Tests run:
Contract changes:
Risks:
Blocked by:
Ready for integration: yes/no
```

If `Contract changes` is not `none`, PM must review before merge.

## Definition of Done

The project is done only when:

- JDC Context Engine name is preserved.
- All three model protocols work.
- Current-session model binding is used for harvest.
- Context injection can be disabled.
- Harvest can be disabled.
- ContextInspect works.
- Harvest Queue works.
- Memory Review works.
- Provider Health works.
- No raw thinking is stored as durable context.
- Greeting turns do not produce harvest data.
- No uncited AI fact is accepted.
- Redaction happens before distillation.
- Store schema migration/rebuild behavior is tested.
- Runtime failure fallback is tested.
- Evals pass.

## PM Warning

The biggest risk is not missing a TypeScript file. The biggest risk is silent low-quality context poisoning the agent.

Treat these as blockers:

- invisible context injection;
- uncited memory;
- wrong model binding;
- raw thinking persistence;
- no fallback path;
- no eval coverage;
- UI that cannot explain why context was injected.

Do not allow production enablement until these blockers are gone.
