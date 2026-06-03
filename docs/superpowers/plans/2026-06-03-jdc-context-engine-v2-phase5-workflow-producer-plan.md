# JDC Context Engine V2 Phase 5 Workflow Producer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project build/test/release workflow knowledge a first-class JDC Context Engine producer, so the model can answer release-flow questions from cited project files instead of manual memory.

**Architecture:** Add a bounded `workflow` provider that reads only known workflow/script files and emits file-backed workflow sections/evidence. Add a `WorkflowRuleDistiller` and harvest route for workflow changes so durable `workflow_rule` facts cite the exact workflow/package files. Keep this project-level, cross-session, fail-open, and free of hidden token/retrieval caps.

**Tech Stack:** TypeScript, Vitest, existing ContextStore/sql.js, existing provider/orchestrator/distiller/harvest contracts, Node `fs/promises`, JSON parsing for package scripts, lightweight YAML text extraction for GitHub workflow command lines.

---

## Hard Product Contracts

- Do not rename `JDC Context Engine`.
- Persist accepted facts under `<project>/.jdcagnet/context-engine/context.db`.
- Project workflow facts are project-level and reusable across sessions.
- Different project roots must not share workflow facts.
- Do not recursively scan the repo in foreground.
- Do not add default token/fact/memory/retrieval caps.
- Workflow facts must cite project files, not raw model reasoning.
- Provider failures must degrade gracefully and never block foreground chat.
- Release/build/test workflow knowledge should be automatic; no user-managed button is required.

## File Structure

- Create: `packages/core/src/context/providers/workflow-provider.ts`
- Create: `packages/core/src/context/workflow-provider.test.ts`
- Create: `packages/core/src/context/distillers/workflow-rule-distiller.ts`
- Modify: `packages/core/src/context/providers/index.ts`
- Modify: `packages/core/src/context/distillers/index.ts`
- Modify: `packages/core/src/context/types.ts`
- Modify: `packages/core/src/context/schemas.ts`
- Modify: `packages/core/src/context/harvest-router.ts`
- Modify: `packages/core/src/context/harvest-router.test.ts`
- Modify: `packages/core/src/context/harvest.ts`
- Modify: `packages/core/src/context/safety.ts`
- Modify: `packages/core/src/context/config.ts`
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/tools/context-refresh.ts`
- Modify: `packages/core/src/context/context-product-evals.test.ts`

## Workflow Provider Contract

Provider id: `workflow`.

Source provider: `WorkflowSignalProvider`.

Bounded file inputs:

- `.github/workflows/*.yml`
- `.github/workflows/*.yaml`
- `package.json`
- `packages/*/package.json`
- package scripts referenced by root package scripts when the referenced path is explicit and within known package directories.

Provider must emit:

- raw evidence with kind `file` or `config`;
- citations with `type:'file'`, `ref` as project-relative path, and `hash`;
- one `project_profile` section titled `Project workflows`;
- health `enabled` when any workflow evidence exists;
- health `stale` with a diagnostic when no workflow/script files are found;
- no recursive repo walk.

## Durable Fact Contract

The distiller maps accepted workflow output to existing `workflow_rule` facts. Do not add a new fact kind unless the implementation proves existing kind is insufficient. Payload:

```ts
export const WorkflowRulePayloadSchema = z.object({
  content: nonEmptyStringSchema,
  workflowType: z.enum(['release', 'build', 'test', 'package', 'ci']),
  commands: z.array(nonEmptyStringSchema),
  files: z.array(nonEmptyStringSchema),
  confidence: confidenceSchema.optional(),
})
```

`contentFromEnvelope()` must render `payload.content`; `kindFromEnvelope()` maps `WorkflowRuleDistiller` to `workflow_rule`; `scopeFromEnvelope()` remains project default.

## Dependencies

Tasks must be done in order:

1. Add provider id/config/provider registry and red tests.
2. Implement bounded workflow provider.
3. Add workflow harvest route and distiller.
4. Wire workflow provider into session/refresh.
5. Add product eval and final verification.

---

### Task 1: Add Workflow Provider Type Surface

**Files:**
- Modify: `packages/core/src/context/types.ts`
- Modify: `packages/core/src/context/schemas.ts`
- Modify: `packages/core/src/context/config.ts`
- Modify: `packages/core/src/context/providers/index.ts`
- Create: `packages/core/src/context/workflow-provider.test.ts`

- [ ] **Step 1: Write failing provider id test**

Create `packages/core/src/context/workflow-provider.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ContextProviderIdSchema } from './schemas.js'
import { DEFAULT_CONTEXT_ENGINE_CONFIG } from './config.js'

describe('WorkflowSignalProvider', () => {
  it('registers workflow as a first-class context provider id', () => {
    expect(ContextProviderIdSchema.safeParse('workflow').success).toBe(true)
    expect(DEFAULT_CONTEXT_ENGINE_CONFIG.providerToggles.workflow).toBe(true)
  })
})
```

- [ ] **Step 2: Verify red**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/workflow-provider.test.ts --no-file-parallelism
```

Expected: FAIL because `workflow` is not in `ContextProviderId`.

- [ ] **Step 3: Add provider id and config**

Update:

- `ContextProviderId` in `types.ts` to include `'workflow'`.
- `ContextProviderIdSchema` in `schemas.ts` to include `'workflow'`.
- `DEFAULT_CONTEXT_ENGINE_CONFIG.providerToggles.workflow = true`.

- [ ] **Step 4: Export provider placeholder**

Export `collectWorkflowContext` and `WorkflowProviderOptions` from `providers/index.ts`. This can point to the implementation added in Task 2.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/workflow-provider.test.ts --no-file-parallelism
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/context/types.ts packages/core/src/context/schemas.ts packages/core/src/context/config.ts packages/core/src/context/providers/index.ts packages/core/src/context/workflow-provider.test.ts
git commit -m "feat(context): add workflow provider surface"
```

---

### Task 2: Implement Bounded Workflow Provider

**Files:**
- Create: `packages/core/src/context/providers/workflow-provider.ts`
- Modify: `packages/core/src/context/workflow-provider.test.ts`

- [ ] **Step 1: Write failing provider behavior tests**

Add tests that create a temp project with:

- `.github/workflows/release.yml` containing `pnpm install`, `pnpm build`, `pnpm package`;
- root `package.json` containing `build`, `test`, and `package` scripts;
- `packages/vscode-extension/package.json` containing extension build/package scripts.

Assert:

- `collectWorkflowContext()` returns one section containing release/build/test/package commands.
- evidence refs include `.github/workflows/release.yml`, `package.json`, and `packages/vscode-extension/package.json`.
- citations include file hashes.
- provider does not read arbitrary nested files outside the bounded list.

- [ ] **Step 2: Verify red**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/workflow-provider.test.ts --no-file-parallelism
```

Expected: FAIL because provider implementation is missing/incomplete.

- [ ] **Step 3: Implement provider**

Create `workflow-provider.ts`:

- Read workflows with `readdir(<cwd>/.github/workflows)` only when that exact directory exists.
- Read root `package.json`.
- Read direct `packages/*/package.json` entries by listing only `packages/` one level deep.
- Parse package JSON with `JSON.parse`; ignore invalid JSON with a warning diagnostic.
- Extract scripts whose key or command contains `build`, `test`, `package`, `pack`, `release`, `publish`, `vsce`, `electron-builder`, `gradle buildPlugin`.
- Extract workflow command lines from `run:` scalar and block sections with a line-oriented parser.
- Use `hashContent()` from `providers/shared.ts` or equivalent existing helper if exported; otherwise add a local SHA-256 helper.
- Emit raw evidence via existing `rawEvidence()` with metadata `{ file, workflowType, commands }`.
- Create `section(..., 'project_profile', 'Project workflows', content, citations, 74, 0.9, 'recent', SOURCE)`.

- [ ] **Step 4: Verify provider tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/workflow-provider.test.ts --no-file-parallelism
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context/providers/workflow-provider.ts packages/core/src/context/workflow-provider.test.ts
git commit -m "feat(context): add workflow signal provider"
```

---

### Task 3: Add Workflow Harvest Route And Distiller

**Files:**
- Create: `packages/core/src/context/distillers/workflow-rule-distiller.ts`
- Modify: `packages/core/src/context/distillers/index.ts`
- Modify: `packages/core/src/context/types.ts`
- Modify: `packages/core/src/context/schemas.ts`
- Modify: `packages/core/src/context/harvest-router.ts`
- Modify: `packages/core/src/context/harvest-router.test.ts`
- Modify: `packages/core/src/context/harvest.ts`
- Modify: `packages/core/src/context/safety.ts`

- [ ] **Step 1: Write failing harvest route tests**

Add tests to `harvest-router.test.ts`:

```ts
expect(routeHarvestCandidate(candidate({
  userMessage: '更新 release workflow',
  changedFiles: ['.github/workflows/release.yml'],
})).action).toBe('distill_workflow_rule')

expect(routeHarvestCandidate(candidate({
  userMessage: '更新 package scripts',
  changedFiles: ['package.json'],
})).action).toBe('distill_workflow_rule')
```

- [ ] **Step 2: Add decision schema**

Add `| { action: 'distill_workflow_rule'; reason: string }` to `HarvestDecision` and `HarvestDecisionSchema`.

- [ ] **Step 3: Implement router**

Before generic changed-file project update routing, route workflow files to `distill_workflow_rule`.

Workflow file matcher:

- `.github/workflows/*.yml`
- `.github/workflows/*.yaml`
- `package.json`
- `packages/*/package.json`

- [ ] **Step 4: Add payload schema**

Add `WorkflowRulePayloadSchema` in `schemas.ts` as defined above.

- [ ] **Step 5: Implement distiller**

Create `workflow-rule-distiller.ts`.

Rules:

- If candidate has structured changed workflow files and no `modelClient`, return deterministic envelope:
  - `content`: `Project workflow changed in <files>. Re-read cited workflow/package files before release/build/test actions.`
  - `workflowType`: infer `release` if any file is under `.github/workflows` or user message contains release/发布; `build` or `test` from message/file command hints; otherwise `ci`.
  - `commands`: best-effort from tool events or empty array when only changedFiles are known.
  - `files`: candidate.changedFiles workflow files.
  - citations: `type:'file'`, `ref:<changed file>`.
- If structured evidence is insufficient and `modelClient` exists, call `completeDistillerEnvelopeWithModel`.
- If no durable workflow fact exists, return `DistillerSkipOutput` with `model_noop`.

- [ ] **Step 6: Wire distiller**

Update:

- `defaultHarvestDistillers`
- payload schema map in `distillers/index.ts`
- `selectDistillerForDecision()`
- `payloadSchemaForDistiller()` in `safety.ts`
- `kindFromEnvelope()` in `harvest.ts` -> `workflow_rule`
- `contentFromEnvelope()` -> prefer payload `content`

- [ ] **Step 7: Verify**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/harvest-router.test.ts src/context/context-harvest.test.ts src/context/workflow-provider.test.ts --no-file-parallelism
```

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/context/distillers/workflow-rule-distiller.ts packages/core/src/context/distillers/index.ts packages/core/src/context/types.ts packages/core/src/context/schemas.ts packages/core/src/context/harvest-router.ts packages/core/src/context/harvest-router.test.ts packages/core/src/context/harvest.ts packages/core/src/context/safety.ts
git commit -m "feat(context): distill release workflow facts"
```

---

### Task 4: Wire Workflow Provider Into Runtime Providers

**Files:**
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/tools/context-refresh.ts`
- Modify: `packages/core/src/context/workflow-provider.test.ts`

- [ ] **Step 1: Write failing registry tests**

Add tests that call `createDefaultRefreshProviders(DEFAULT_CONTEXT_ENGINE_CONFIG)` and assert provider ids include `workflow`.

If there is no direct test for `Session.getContextProviders()`, add a narrow exported helper only if necessary. Prefer testing `createDefaultRefreshProviders()` and product eval rather than making private session internals public.

- [ ] **Step 2: Wire refresh providers**

In `context-refresh.ts`:

- import `collectWorkflowContext`;
- include `{ id:'workflow', collect: ..., health: ... }` in `createDefaultRefreshProviders()`;
- respect `toggles.workflow`.

- [ ] **Step 3: Wire session providers**

In `session.ts`, include workflow in `this.contextProviders` / `getContextProviders()` using the same toggle pattern as project/git/memory.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/workflow-provider.test.ts src/context/context-product-evals.test.ts --no-file-parallelism
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session.ts packages/core/src/tools/context-refresh.ts packages/core/src/context/workflow-provider.test.ts
git commit -m "feat(context): wire workflow provider into runtime"
```

---

### Task 5: Product Eval And File Invalidation

**Files:**
- Modify: `packages/core/src/context/context-product-evals.test.ts`
- Modify: `packages/core/src/context/workflow-provider.test.ts`
- Modify if needed: `packages/core/src/session.ts`
- Modify if needed: `packages/core/src/context/store.ts`

- [ ] **Step 1: Write release-flow product eval**

Add eval:

- create temp project;
- write `.github/workflows/release.yml` with release steps;
- run `collectWorkflowContext()` and persist evidence through `buildContextBundle()`;
- save a `workflow_rule` fact with file citation, or run harvest distiller if the test path is clearer;
- ask `我们的发布流程是咋样的`;
- assert rendered context contains `pnpm build`, `pnpm package`, and release workflow file path.

- [ ] **Step 2: Write invalidation test**

Use real `ContextStore`:

- save raw evidence for `.github/workflows/release.yml` with hash `old_hash`;
- save `workflow_rule` fact citing that file and hash;
- call `invalidateByFileHash('.github/workflows/release.yml', 'new_hash')`;
- assert fact freshness becomes `stale`;
- assert `buildContextBundle()` does not inject stale low-value workflow facts unless query/retriever explicitly allows stale high-value. Default product contract: changed workflow should not keep stale release instructions in primary injection.

- [ ] **Step 3: Implement fixes if eval fails**

Likely implementation points:

- ensure provider citations include file hash;
- ensure session file invalidation passes project-relative path for workflow files;
- ensure retriever suppresses stale workflow facts by default.

- [ ] **Step 4: Final verification**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/workflow-provider.test.ts src/context/context-product-evals.test.ts src/context/context-orchestrator.test.ts --no-file-parallelism
```

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/harvest-router.test.ts src/context/context-harvest.test.ts src/context/context-retriever.test.ts --no-file-parallelism
```

Run:

```bash
pnpm --filter @jdcagnet/core build
```

Run:

```bash
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context/context-product-evals.test.ts packages/core/src/context/workflow-provider.test.ts packages/core/src/session.ts packages/core/src/context/store.ts
git commit -m "test(context): answer release flow from workflow evidence"
```

## Acceptance Criteria

- Workflow provider reads only bounded workflow/script files.
- Provider emits file/config evidence and cited project workflow section.
- Workflow provider is available in session injection and context refresh.
- Workflow changes route to `WorkflowRuleDistiller`.
- Workflow facts are stored as `workflow_rule` with file citations.
- Release-flow questions retrieve workflow facts across sessions.
- Workflow/package file changes stale old workflow facts.
- No hidden token/fact/memory/retrieval caps are added.

## Verification Commands

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/workflow-provider.test.ts src/context/context-product-evals.test.ts src/context/context-orchestrator.test.ts --no-file-parallelism
```

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/harvest-router.test.ts src/context/context-harvest.test.ts src/context/context-retriever.test.ts --no-file-parallelism
```

```bash
pnpm --filter @jdcagnet/core build
```

```bash
git diff --check
```
