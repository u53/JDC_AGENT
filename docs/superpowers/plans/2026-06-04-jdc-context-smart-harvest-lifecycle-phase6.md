# JDC Context Smart Harvest Lifecycle Phase 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend existing store maintenance so interrupted harvest jobs self-repair instead of lingering forever.

**Architecture:** Build on `ContextStore.enforceQuotas()`. Repair old in-progress harvest jobs as quiet skipped timeout jobs, persist diagnostics, and keep foreground chat unaffected.

**Tech Stack:** TypeScript, Vitest, sql.js context store.

---

## File Map

- Modify `packages/core/src/context/store.ts`
  - Add `staleHarvestJobTtlMs` maintenance quota.
  - Add optional `repairedHarvestJobs` to quota enforcement results.
  - Repair stale `queued`, `classified`, `distilling`, and `validating` harvest jobs during `enforceQuotas()`.
  - Persist a quiet diagnostic for repaired jobs.

- Modify `packages/core/src/context/store.test.ts`
  - Add repair test for stale in-progress harvest jobs.

## Task 1: Harvest Job Self-Repair

- [x] **Step 1: Write failing store test**

Add a test with an old `distilling` job and a recent `distilling` job, then call `enforceQuotas()`.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts -t "repairs stale" --no-file-parallelism
```

Expected before implementation: FAIL because no stale job repair exists.

- [x] **Step 3: Implement store maintenance repair**

Add `staleHarvestJobTtlMs`, repair stale in-progress jobs to `skipped` with timeout decision, and write diagnostics.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts -t "repairs stale" --no-file-parallelism
```

Expected: PASS.

## Task 2: Verification

- [x] **Step 1: Run focused tests**

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts src/context/context-harvest.test.ts src/context/context-orchestrator.test.ts src/context/context-retriever.test.ts --no-file-parallelism
```

- [x] **Step 2: Run build**

```bash
pnpm --filter @jdcagnet/core build
```

- [x] **Step 3: Run diff whitespace check**

```bash
git diff --check
```
