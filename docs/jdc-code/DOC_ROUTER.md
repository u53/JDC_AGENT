# JDC CODE Document Router

This file tells agents which durable documents to read before working on a task. Use it after reading the root `JDCAGNET.md` and before changing behavior.

## Universal Recovery Set

Read these when the task is broad, after compaction, or when the user says "继续", "下一步", "where were we", or similar:

1. `JDCAGNET.md`
2. `docs/jdc-code/OPERATING_CONTRACT.md`
3. `docs/jdc-code/COMPACTION_RECOVERY.md`
4. `git status --short --branch`
5. `git log --oneline -8`
6. The most relevant plan/spec from the table below

## Context Engine Work

Triggers:

- `JDC Context Engine`
- memory/context injection/retrieval/harvest
- same-project cross-session knowledge
- context.db persistence
- Context panel / inspector
- code indexing health
- provider health
- CPU/performance of context work

Read:

- `docs/superpowers/specs/2026-06-03-jdc-context-engine-v2-design.md`
- `docs/superpowers/specs/2026-06-01-jdc-context-engine-engineering-contract.md`
- `docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-master-roadmap.md`
- The matching phase plan:
  - Phase 0 capacity/runtime: `docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-phase0-capacity-runtime-plan.md`
  - Phase 1 retrieval: `docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-phase1-retrieval-plan.md`
  - Phase 2 provenance: `docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-phase2-provenance-plan.md`
  - Phase 3 actor packs: `docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-phase3-actor-packs-plan.md`
  - Phase 4 Team ledger: `docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-phase4-team-ledger-plan.md`
  - Phase 5 workflow producer: `docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-phase5-workflow-producer-plan.md`
  - Phase 6 UI diagnostics: `docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-phase6-ui-diagnostics-plan.md`
  - Phase 7 performance/evals: `docs/superpowers/plans/2026-06-04-jdc-context-engine-v2-phase7-performance-evals-plan.md`

Code entry points:

- `packages/core/src/context/config.ts`
- `packages/core/src/context/orchestrator.ts`
- `packages/core/src/context/retriever.ts`
- `packages/core/src/context/store.ts`
- `packages/core/src/context/harvest.ts`
- `packages/core/src/context/scheduler.ts`
- `packages/core/src/session.ts`
- `packages/core/src/sub-session.ts`
- `packages/core/src/tools/memory-search.ts`
- `packages/core/src/tools/memory-write.ts`
- `packages/core/src/tools/context-engine-tools.ts`
- `packages/ui/src/components/context/*`

Verification:

- `pnpm --filter @jdcagnet/core exec vitest run src/context/context-config.test.ts src/context/context-retriever.test.ts src/context/context-orchestrator.test.ts src/context/context-product-evals.test.ts src/context/context-harvest.test.ts src/context/context-scheduler.test.ts src/context/context-performance.test.ts src/session-context.test.ts --no-file-parallelism`
- `pnpm --filter @jdcagnet/core build`
- UI tests/build when UI changes.

## Prompt / Provider Work

Triggers:

- base prompt
- identity
- system prompt
- Anthropic/OpenAI protocol
- cacheable segments
- thinking/adaptive thinking
- request shape 400 errors

Read:

- `docs/jdc-code/OPERATING_CONTRACT.md`
- `docs/claude-code-impersonation.md`
- `docs/superpowers/specs/2026-06-03-jdc-context-engine-v2-design.md`
- `docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-phase0-capacity-runtime-plan.md`

Code entry points:

- `packages/core/src/base-prompt.ts`
- `packages/core/src/context.ts`
- `packages/core/src/providers/anthropic.ts`
- `packages/core/src/providers/openai-chat.ts`
- `packages/core/src/providers/openai-responses.ts`
- `packages/core/src/session.ts`
- `packages/core/src/sub-session.ts`

Verification:

- `pnpm --filter @jdcagnet/core exec vitest run src/base-prompt.test.ts src/providers/provider-prompt-contract.test.ts src/session-context.test.ts --no-file-parallelism`
- `pnpm --filter @jdcagnet/core build`

## Session / Compaction Work

Triggers:

- compaction
- compact summary
- context lost after compression
- "continue" resumes wrong thing
- current plan restore
- tool result clearing

Read:

- `docs/jdc-code/COMPACTION_RECOVERY.md`
- `docs/jdc-code/OPERATING_CONTRACT.md`
- `docs/superpowers/specs/2026-06-02-team-subagent-model-resolution-and-compaction-design.md`

Code entry points:

- `packages/core/src/session.ts`
- `packages/core/src/compact.ts`
- `packages/core/src/context.ts`
- `packages/core/src/sub-session.ts`
- `packages/core/src/team/team-manager-ai.ts`

Verification:

- `pnpm --filter @jdcagnet/core exec vitest run src/session-context.test.ts src/context-legacy-memory.test.ts --no-file-parallelism`
- `pnpm --filter @jdcagnet/core build`

## Team / PM / Worker Work

Triggers:

- Team
- PM
- worker
- team artifacts
- team ledger
- task dependencies
- background team
- team completion

Read:

- `docs/superpowers/specs/2026-05-20-team-mode-design.md`
- `docs/superpowers/specs/2026-05-22-team-workspace-design.md`
- `docs/superpowers/plans/2026-05-22-team-workspace-phase1.md`
- `docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-phase4-team-ledger-plan.md`

Code entry points:

- `packages/core/src/tools/team.ts`
- `packages/core/src/team/team-manager.ts`
- `packages/core/src/team/team-manager-ai.ts`
- `packages/core/src/team/team-member.ts`
- `packages/core/src/team/team-workspace.ts`
- `packages/core/src/tools/team-artifact.ts`
- `packages/core/src/context/team-ledger.ts`

Verification:

- Team-related tests under `packages/core/src/__tests__/*team*`
- `pnpm --filter @jdcagnet/core exec vitest run src/context/team-ledger.test.ts --no-file-parallelism`
- `pnpm --filter @jdcagnet/core build`

## UI / Inspector Work

Triggers:

- UI
- Inspector
- Context panel
- tool card
- robot animation
- Chinese labels
- diagnostics visibility
- production hiding

Read:

- `docs/superpowers/specs/2026-05-13-jdcagnet-ui-overhaul-master-plan.md`
- Relevant UI overhaul spec under `docs/superpowers/specs/`
- `docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-phase6-ui-diagnostics-plan.md`
- `docs/superpowers/specs/2026-06-03-jdc-context-engine-v2-design.md`

Code entry points:

- `packages/ui/src/components/*`
- `packages/ui/src/components/context/*`
- `packages/ui/src/stores/context-store.ts`
- `packages/ui/src/lib/context-inspector-visibility.ts`
- `packages/core/src/tools/context-inspect.ts`
- `packages/core/src/tools/context-refresh.ts`

Verification:

- `pnpm --filter @jdcagnet/ui exec vitest run src/components/context/context-panels.test.tsx src/stores/context-store.test.tsx src/lib/context-inspector-visibility.test.ts --no-file-parallelism`
- `pnpm --filter @jdcagnet/ui build`

## Codegraph / JDC Code Intelligence Work

Triggers:

- JdcSearch
- JdcContext
- code graph
- symbol index
- call graph
- impact analysis
- Tree-sitter

Read:

- `docs/superpowers/plans/2026-05-25-codegraph-integration.md`
- `docs/superpowers/specs/2026-05-25-codegraph-integration-design.md`
- `docs/jdc-code/OPERATING_CONTRACT.md`

Code entry points:

- `packages/core/src/context-engine/*`
- `packages/core/src/tools/context-engine-tools.ts`
- `packages/core/src/tools/__tests__/context-engine-tools.test.ts`

Verification:

- `pnpm --filter @jdcagnet/core exec vitest run src/tools/__tests__/context-engine-tools.test.ts --no-file-parallelism`
- `pnpm --filter @jdcagnet/core build`

## MCP / Skills / Hooks Work

Triggers:

- MCP
- skills
- hooks
- plugin/tool server
- resource/prompt server

Read:

- `docs/superpowers/specs/2026-05-13-jdcagnet-phase2b-design.md`
- `docs/superpowers/plans/2026-05-13-jdcagnet-phase2b.md`
- `docs/jdc-code/OPERATING_CONTRACT.md`

Code entry points:

- `packages/core/src/mcp/*`
- `packages/core/src/skills/*`
- `packages/core/src/hooks/*`
- `packages/core/src/tools/list-mcp-resources.ts`
- `packages/core/src/tools/read-mcp-resource.ts`

Verification:

- MCP/skills/hooks tests matching the touched files.
- `pnpm --filter @jdcagnet/core build`

## Background Tasks Work

Triggers:

- background task
- run_in_background
- task notification
- background shell
- monitor

Read:

- `docs/superpowers/specs/2026-05-19-background-tasks-design.md`
- `docs/superpowers/plans/2026-05-19-background-tasks.md`

Code entry points:

- `packages/core/src/background-tasks.ts`
- `packages/core/src/tools/background-*`
- `packages/core/src/tools/agent.ts`
- `packages/core/src/tools/bash.ts`
- `packages/core/src/tools/monitor.ts`

Verification:

- Background task tests.
- `pnpm --filter @jdcagnet/core build`

## Release / Packaging Work

Triggers:

- release
- package
- version bump
- build app
- VSIX
- electron builder

Read:

- `README.md`
- `README.zh-CN.md`
- `.github/workflows/*` if present.
- Any durable workflow facts from JDC Context Engine memory.

Code entry points:

- `package.json`
- `packages/*/package.json`
- `electron-builder.yml`
- `packages/vscode-extension/*`

Verification:

- Use scripts from `package.json`.
- Run the smallest relevant package build first.
- Run root build only when needed.

## When No Route Matches

If no route matches:

1. Read root `JDCAGNET.md`.
2. Inspect `README.md`, package scripts, and nearby files.
3. Use `rg` to find relevant code and docs.
4. Create a short plan in the response before editing if the task touches multiple files.

Do not invent a new documentation island. If the task reveals a missing route, update this file.
