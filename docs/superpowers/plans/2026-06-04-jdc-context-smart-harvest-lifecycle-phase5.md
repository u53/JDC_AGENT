# JDC Context Smart Harvest Lifecycle Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make retrieval lifecycle-aware while keeping normal prompt injection focused on relevant active facts.

**Architecture:** Keep default retrieval conservative. Add explicit lifecycle inspection options for inactive facts, pass them to the store, and make lifecycle metadata searchable when inspection is requested.

**Tech Stack:** TypeScript, Vitest, JDC Context Engine retriever/store/orchestrator modules.

---

## File Map

- Modify `packages/core/src/context/retriever.ts`
  - Add `includeInactive` and `status` retrieval options.
  - Pass lifecycle filters to `listAcceptedProjectFacts()`.
  - Keep inactive facts suppressed by default.
  - Include lifecycle metadata in searchable fact text.

- Modify `packages/core/src/context/context-retriever.test.ts`
  - Add explicit inactive lifecycle inspection test.

## Task 1: Explicit Lifecycle Inspection

- [x] **Step 1: Write failing retrieval test**

Add a test for `retrieveContextFacts(..., { includeInactive: true, status: 'superseded' })`.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-retriever.test.ts -t "lifecycle inspection" --no-file-parallelism
```

Expected before implementation: FAIL because retriever does not pass lifecycle inspection options and suppresses inactive facts.

- [x] **Step 3: Implement lifecycle-aware retrieval options**

Wire `includeInactive` and `status` into store queries and inactive filtering.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-retriever.test.ts --no-file-parallelism
```

Expected: PASS.

## Task 2: Verification

- [x] **Step 1: Run focused tests**

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-retriever.test.ts src/context/store.test.ts src/context/context-orchestrator.test.ts src/context/signal-providers.test.ts --no-file-parallelism
```

- [x] **Step 2: Run build**

```bash
pnpm --filter @jdcagnet/core build
```

- [x] **Step 3: Run diff whitespace check**

```bash
git diff --check
```
