# JDC Context Engine V2 Phase 7 Performance And Eval Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make JDC Context Engine measurable, budgeted, fail-open, and regression-tested so normal chat, session switching, panel reads, harvest, and project warmup do not feel heavy.

**Architecture:** Keep the existing `ContextScheduler`/`ContextPerformanceRecorder` and wire it through the real hot paths: retrieval, context bundle assembly, harvest, store writes, and project warmup. Performance gates are eval-style tests with deterministic clocks; they do not add artificial context token caps or hide useful project facts.

**Tech Stack:** TypeScript, Vitest, existing sql.js `ContextStore`, `ContextScheduler`, `ContextPerformanceRecorder`, Electron `SessionManager`, and existing JDC Context Engine providers/retriever/harvest pipeline.

---

## Hard Product Contracts

- Do not rename `JDC Context Engine`.
- Do not move persistence out of `.jdcagnet/context-engine/`.
- Do not add an arbitrary engine token cap such as 8k or 32k.
- Do not inject all memories; retrieval remains relevance-first.
- Do not run model harvest in foreground injection.
- Do not start full code indexing from Context panel reads.
- Do not make normal users manually refresh/reindex for the engine to work.
- Do not let skipped, timed-out, cancelled, rejected, or no-op harvest output become accepted project context or primary UI content.
- Do not let performance tests depend on real wall-clock speed except where explicitly measuring deterministic fake-clock durations.

## Current Baseline

As of `7e3d8a2`:

- `packages/core/src/context/performance.ts` records raw operation metrics.
- `packages/core/src/context/scheduler.ts` supports foreground timeout fallback, project background concurrency, project/job interval limiting, and project cancellation.
- `Session.injectContextForRunLoop()` and `runSubSession()` already use `ContextScheduler.runForeground()`.
- Main and sub-session harvest enqueue through `ContextScheduler.enqueueBackground()`.
- `SqlJsContextStore.saveRawEvidence()` uses `flush: false`, but most row writes still export the full sql.js database immediately.
- `buildContextBundle()` saves evidence, bundle snapshots, quota results, and diagnostics on every foreground injection.
- `retrieveContextFacts()` has no performance recorder input, so retrieval latency/fact counts are not visible.
- `runHarvestJob()` has timeout/cancel handling, but harvest latency/status is not recorded in the shared recorder.

## File Structure

- Create: `packages/core/src/context/context-performance.test.ts`
- Modify: `packages/core/src/context/performance.ts`
- Modify: `packages/core/src/context/scheduler.ts`
- Modify: `packages/core/src/context/retriever.ts`
- Modify: `packages/core/src/context/orchestrator.ts`
- Modify: `packages/core/src/context/harvest.ts`
- Modify: `packages/core/src/context/context-scheduler.test.ts`
- Modify: `packages/core/src/context/context-product-evals.test.ts`
- Modify: `packages/core/src/context/context-orchestrator.test.ts`
- Modify: `packages/core/src/context/context-harvest.test.ts`
- Modify: `packages/core/src/context/store.ts`
- Modify: `packages/core/src/context/store.test.ts`
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/sub-session.ts`
- Modify: `packages/electron/src/session-manager.ts`

## Task Dependencies

Tasks must be done in order:

1. Save this plan and verify the baseline.
2. Add performance summary primitives.
3. Instrument retrieval and bundle assembly.
4. Instrument harvest latency and skipped/no-op behavior.
5. Add store flush batching for foreground bundle writes.
6. Harden project warmup scheduling and cancellation.
7. Add Phase 7 product eval gates and full verification.

Do not start Task 5 before Task 3 is green. Store batching changes need bundle instrumentation so the tests can prove write/export count moves in the right direction.

---

### Task 1: Lock Phase 7 Plan And Baseline

**Files:**
- Create: `docs/superpowers/plans/2026-06-04-jdc-context-engine-v2-phase7-performance-evals-plan.md`

- [ ] **Step 1: Save this plan**

Create this plan file exactly at:

```text
docs/superpowers/plans/2026-06-04-jdc-context-engine-v2-phase7-performance-evals-plan.md
```

- [ ] **Step 2: Install worktree dependencies**

Run:

```bash
pnpm install
```

Expected: exit code 0. The known macOS Electron icon copy warning is acceptable when install exits 0.

- [ ] **Step 3: Verify Phase 7 baseline**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-scheduler.test.ts src/context/context-product-evals.test.ts src/session-context.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-06-04-jdc-context-engine-v2-phase7-performance-evals-plan.md
git commit -m "docs(context): add phase 7 performance plan"
```

---

### Task 2: Add Performance Summary Primitives

**Files:**
- Create: `packages/core/src/context/context-performance.test.ts`
- Modify: `packages/core/src/context/performance.ts`

- [ ] **Step 1: Write failing metric metadata and summary tests**

Create `packages/core/src/context/context-performance.test.ts` with tests that require:

```ts
import { describe, expect, it } from 'vitest'
import { createContextPerformanceRecorder, recordContextOperation, summarizeContextPerformance } from './performance.js'

describe('JDC Context Engine performance metrics', () => {
  it('summarizes operation counts, percentiles, and metadata without wall-clock assumptions', () => {
    let clock = 1_000
    const recorder = createContextPerformanceRecorder({ now: () => clock, maxOperations: 10 })

    recorder.record({ name: 'context:retrieve-facts', lane: 'foreground', status: 'success', startedAt: 1_000, completedAt: 1_020, projectKey: '/repo', metadata: { factCount: 120 } })
    recorder.record({ name: 'context:retrieve-facts', lane: 'foreground', status: 'success', startedAt: 1_020, completedAt: 1_080, projectKey: '/repo', metadata: { factCount: 80 } })
    recorder.record({ name: 'context:harvest', lane: 'background', status: 'timeout', startedAt: 2_000, completedAt: 2_500, projectKey: '/repo', metadata: { runLoopId: 'run-1' } })

    const summary = summarizeContextPerformance(recorder.snapshot())

    expect(summary.totalOperations).toBe(3)
    expect(summary.byStatus.success).toBe(2)
    expect(summary.byStatus.timeout).toBe(1)
    expect(summary.byName['context:retrieve-facts']).toMatchObject({ count: 2, p50Ms: 20, p95Ms: 60, maxMs: 60 })
    expect(summary.slowest[0]).toMatchObject({ name: 'context:harvest', durationMs: 500, metadata: { runLoopId: 'run-1' } })
  })

  it('records async operation success and failure with metadata', async () => {
    let clock = 10
    const recorder = createContextPerformanceRecorder({ now: () => clock })

    const value = await recordContextOperation(recorder, {
      name: 'context:pack-assemble',
      lane: 'foreground',
      projectKey: '/repo',
      metadata: { sectionCount: 3 },
      now: () => clock,
    }, async () => {
      clock = 42
      return 'ok'
    })

    await expect(recordContextOperation(recorder, {
      name: 'context:store-write',
      lane: 'storage',
      projectKey: '/repo',
      now: () => clock,
    }, async () => {
      clock = 50
      throw new Error('db export failed')
    })).rejects.toThrow('db export failed')

    expect(value).toBe('ok')
    expect(recorder.snapshot().operations.map((operation) => operation.status)).toEqual(['success', 'failed'])
    expect(recorder.snapshot().operations[1].diagnostic).toBe('db export failed')
  })
})
```

- [ ] **Step 2: Verify red**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-performance.test.ts --no-file-parallelism
```

Expected: FAIL because `metadata`, `summarizeContextPerformance`, and `recordContextOperation` do not exist.

- [ ] **Step 3: Implement minimal primitives**

In `packages/core/src/context/performance.ts`:

- add `metadata?: Record<string, string | number | boolean | null>` to `ContextOperationMetric`;
- export `recordContextOperation<T>()`;
- export `summarizeContextPerformance()`;
- compute p50 and p95 from sorted durations with nearest-rank indexing;
- keep the existing recorder API backward compatible.

- [ ] **Step 4: Verify green**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-performance.test.ts src/context/context-scheduler.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context/performance.ts packages/core/src/context/context-performance.test.ts packages/core/src/context/context-scheduler.test.ts
git commit -m "feat(context): add context performance summaries"
```

---

### Task 3: Instrument Retrieval And Bundle Assembly

**Files:**
- Modify: `packages/core/src/context/context-performance.test.ts`
- Modify: `packages/core/src/context/retriever.ts`
- Modify: `packages/core/src/context/orchestrator.ts`
- Modify: `packages/core/src/context/context-orchestrator.test.ts`

- [ ] **Step 1: Write failing bundle instrumentation test**

Add a test to `context-performance.test.ts` that builds a bundle with a fake store containing many accepted facts and asserts:

```ts
expect(operationNames).toContain('context:retrieve-facts')
expect(operationNames).toContain('context:pack-assemble')
expect(retrieveMetric.metadata?.candidateCount).toBe(200)
expect(packMetric.metadata?.sectionCount).toBeGreaterThan(0)
expect(packMetric.metadata?.usedTokens).toBeGreaterThan(0)
```

The test must construct a `ContextScheduler` with a deterministic `recorder` and pass it into `buildContextBundle()`.

- [ ] **Step 2: Verify red**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-performance.test.ts --no-file-parallelism
```

Expected: FAIL because retriever and bundle assembly do not record these metrics.

- [ ] **Step 3: Instrument retriever**

Update `ContextRetrievalOptions` in `retriever.ts`:

```ts
recorder?: ContextPerformanceRecorder
projectKey?: string
```

Wrap the store load, score, filter, and sort block with `recordContextOperation()` named `context:retrieve-facts`. Metadata must include:

```ts
{
  candidateCount: loaded.value.length,
  returnedCount: facts.length,
  queryPresent: Boolean(query),
}
```

- [ ] **Step 4: Pass recorder from orchestrator**

In `loadStoreFacts()` inside `orchestrator.ts`, pass:

```ts
recorder: scheduler.recorder,
projectKey: request.cwd,
```

If needed, thread `scheduler` into `loadStoreFacts()` rather than creating a second recorder.

- [ ] **Step 5: Record pack assembly**

In `buildContextBundle()`, record `context:pack-assemble` after `budgetContextSections()` with metadata:

```ts
{
  rawSectionCount: rawSections.length,
  plannedSectionCount: plannedSections.length,
  sectionCount: budgeted.sections.length,
  usedTokens: budgeted.budget.usedTokens,
  droppedTokens: budgeted.budget.droppedTokens,
  droppedSectionCount: budgeted.dropped.length,
}
```

Do not change the no-artificial-cap behavior.

- [ ] **Step 6: Verify green**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-performance.test.ts src/context/context-orchestrator.test.ts src/context/context-retriever.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/context/performance.ts packages/core/src/context/retriever.ts packages/core/src/context/orchestrator.ts packages/core/src/context/context-performance.test.ts packages/core/src/context/context-orchestrator.test.ts
git commit -m "feat(context): record retrieval and bundle metrics"
```

---

### Task 4: Instrument Harvest Latency And Noise Suppression

**Files:**
- Modify: `packages/core/src/context/harvest.ts`
- Modify: `packages/core/src/context/context-harvest.test.ts`
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/sub-session.ts`
- Modify: `packages/core/src/context/context-product-evals.test.ts`

- [ ] **Step 1: Write failing harvest metric test**

In `context-harvest.test.ts`, add a test that calls `runHarvestJob()` with a `recorder` and asserts:

```ts
const metric = recorder.snapshot().operations.find((operation) => operation.name === 'context:harvest')
expect(metric).toMatchObject({
  lane: 'background',
  status: 'success',
  projectKey: '/repo',
})
expect(metric?.metadata).toMatchObject({ runLoopId: 'run-1', finalStatus: 'accepted' })
```

Add a second test for timeout/cancelled harvest that asserts no rejected memory candidate is written and the metric status is `timeout` or `cancelled`.

- [ ] **Step 2: Verify red**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-harvest.test.ts --no-file-parallelism
```

Expected: FAIL because `RunHarvestJobOptions` has no recorder.

- [ ] **Step 3: Implement harvest performance recording**

In `RunHarvestJobOptions`, add:

```ts
recorder?: ContextPerformanceRecorder
projectKey?: string
```

Wrap the current `runHarvestJob()` body with a helper that records one `context:harvest` metric. Map final harvest statuses:

- `accepted` -> `success`;
- `pending_review`, `rejected`, `failed` -> `failed`;
- `skipped` -> `rejected` when it is policy/rate/noop skip, not an error;
- timeout/cancel exceptions -> `timeout`;
- external abort -> `cancelled`.

Metadata must include `sessionId`, `runLoopId`, and `finalStatus`.

- [ ] **Step 4: Pass the shared recorder from runtime**

In `session.ts` and `sub-session.ts`, pass:

```ts
recorder: this.contextScheduler.recorder
```

or:

```ts
recorder: contextScheduler.recorder
```

into `runHarvestJob()`, along with `projectKey: cwd`.

- [ ] **Step 5: Add no-harvest-on-noise product eval**

In `context-product-evals.test.ts`, assert that greeting/`继续`/short acknowledgement candidates are skipped before model distillation and do not produce accepted facts or primary rejected rows.

- [ ] **Step 6: Verify green**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-harvest.test.ts src/context/context-product-evals.test.ts src/session-context.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/context/harvest.ts packages/core/src/context/context-harvest.test.ts packages/core/src/context/context-product-evals.test.ts packages/core/src/session.ts packages/core/src/sub-session.ts
git commit -m "perf(context): record harvest budgets and noise skips"
```

---

### Task 5: Batch Store Flushes On Foreground Bundle Writes

**Files:**
- Modify: `packages/core/src/context/store.ts`
- Modify: `packages/core/src/context/store.test.ts`
- Modify: `packages/core/src/context/orchestrator.ts`
- Modify: `packages/core/src/context/context-performance.test.ts`

- [ ] **Step 1: Write failing store batching test**

In `store.test.ts`, add a test using a temporary context DB and a spyable `persist` hook if available, or inspect file mtime/write count through a test-only store option. The test must prove saving many raw evidence rows inside a batch flushes once, not once per row:

```ts
await store.withWriteBatch(async () => {
  for (const evidence of evidenceRows) await store.saveRawEvidence(evidence)
  await store.saveBundleSnapshot(bundle)
})
expect(persistCount).toBe(1)
```

- [ ] **Step 2: Verify red**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts --no-file-parallelism
```

Expected: FAIL because `ContextStore.withWriteBatch()` does not exist.

- [ ] **Step 3: Add store batching API**

Add to `ContextStore`:

```ts
withWriteBatch<T>(operation: string, fn: () => Promise<T> | T): Promise<ContextStoreResult<T>>
```

Implement in `SqlJsContextStore` with a private `batchDepth` counter:

- nested batches are allowed;
- row writes mark dirty but do not flush while `batchDepth > 0`;
- the outermost successful batch flushes once if dirty;
- failed batches return diagnostics and still leave dirty state flushable on close.

Implement a no-op fallback in `UnavailableContextStore`.

- [ ] **Step 4: Use batch in orchestrator hot path**

In `buildContextBundle()`, batch:

- `persistProviderEvidence()`;
- `saveBundleSnapshot()`;
- `enforceQuotas()`;
- `persistDiagnostics()`.

The result must preserve diagnostics from each operation.

- [ ] **Step 5: Verify green**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts src/context/context-performance.test.ts src/context/context-orchestrator.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/context/store.ts packages/core/src/context/store.test.ts packages/core/src/context/orchestrator.ts packages/core/src/context/context-performance.test.ts
git commit -m "perf(context): batch context store foreground writes"
```

---

### Task 6: Harden Project Warmup Scheduling

**Files:**
- Modify: `packages/electron/src/session-manager.ts`
- Modify: `packages/core/src/context/context-scheduler.test.ts`

- [ ] **Step 1: Write scheduler cancellation test**

Extend `context-scheduler.test.ts` to assert that cancelling a project records a cancellation metric after the task settles and prevents a second heavy job until the first settles.

- [ ] **Step 2: Add SessionManager warmup policy**

In `session-manager.ts`:

- keep the existing delayed warmup;
- cancel pending warm timers for projects that are no longer active when the active session changes;
- do not call `ideManager.startDiscovery(cwd)` immediately from activation when a delayed warmup is pending;
- ensure `ensureCodeIndexJob()` is called only from the delayed warm path, never synchronously from panel reads.

- [ ] **Step 3: Verify**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-scheduler.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/electron build
```

If `@jdcagnet/electron build` is not available in the workspace, run:

```bash
pnpm build
```

and record the actual result in the final handoff.

- [ ] **Step 4: Commit**

```bash
git add packages/electron/src/session-manager.ts packages/core/src/context/context-scheduler.test.ts
git commit -m "perf(context): defer project warm indexing"
```

---

### Task 7: Final Phase 7 Product Eval And Verification

**Files:**
- Modify: `packages/core/src/context/context-performance.test.ts`
- Modify: `packages/core/src/context/context-product-evals.test.ts`

- [ ] **Step 1: Add product eval for large memory set**

In `context-product-evals.test.ts`, assert that hundreds of accepted facts do not all enter the rendered prompt and that an old relevant fact still wins over newer irrelevant facts. This must not assert a fixed token cap; assert relevance behavior.

- [ ] **Step 2: Add performance eval for cached bundle assembly**

In `context-performance.test.ts`, use a deterministic fake clock and assert the performance snapshot contains:

```ts
context:retrieve-facts
context:pack-assemble
context:harvest
```

with metadata sufficient to explain candidate counts, returned counts, used tokens, dropped tokens, and final harvest status.

- [ ] **Step 3: Run Phase 7 verification**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-performance.test.ts src/context/context-scheduler.test.ts src/context/context-product-evals.test.ts src/context/context-orchestrator.test.ts src/context/context-retriever.test.ts src/context/context-harvest.test.ts src/context/store.test.ts src/session-context.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 4: Run builds**

Run:

```bash
pnpm --filter @jdcagnet/core build
pnpm --filter @jdcagnet/ui build
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Commit if Task 7 changes code**

```bash
git add packages/core/src/context/context-performance.test.ts packages/core/src/context/context-product-evals.test.ts
git commit -m "test(context): cover phase 7 performance budgets"
```

---

## Acceptance Checklist

- [ ] Performance recorder exposes metadata, per-name summaries, p50/p95/max, status counts, and slowest operations.
- [ ] Retrieval records candidate count, returned count, and query presence.
- [ ] Bundle assembly records section counts, used tokens, dropped tokens, and dropped section count.
- [ ] Harvest records latency and final status without showing cancelled/timeout/no-op as primary user memory.
- [ ] Main and sub-session harvest use the shared scheduler recorder.
- [ ] Foreground bundle writes batch sql.js exports instead of flushing after every row.
- [ ] Project activation warmup remains delayed and does not synchronously start heavy index work on session switch.
- [ ] Panel reads remain read-only and do not trigger reindex/harvest.
- [ ] Large memory sets are selected by relevance, not dumped wholesale and not capped by an arbitrary engine token limit.
- [ ] Core and UI builds pass.

## Final Verification Commands

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-performance.test.ts src/context/context-scheduler.test.ts src/context/context-product-evals.test.ts src/context/context-orchestrator.test.ts src/context/context-retriever.test.ts src/context/context-harvest.test.ts src/context/store.test.ts src/session-context.test.ts --no-file-parallelism
```

```bash
pnpm --filter @jdcagnet/core build
```

```bash
pnpm --filter @jdcagnet/ui build
```

```bash
git diff --check
```

## Recommended Commit Messages

```bash
git commit -m "docs(context): add phase 7 performance plan"
git commit -m "feat(context): add context performance summaries"
git commit -m "feat(context): record retrieval and bundle metrics"
git commit -m "perf(context): record harvest budgets and noise skips"
git commit -m "perf(context): batch context store foreground writes"
git commit -m "perf(context): defer project warm indexing"
git commit -m "test(context): cover phase 7 performance budgets"
```
