# JDC Context Smart Harvest Lifecycle Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow one harvest distiller output to contain multiple cited facts and accept each valid fact independently.

**Architecture:** Extend the distiller output schema with `DistillerBatchOutput`. Keep existing single-envelope and skip outputs compatible. In `runHarvestJob()`, process batch facts one by one: valid facts save, invalid facts become rejected candidates, and at least one accepted fact makes the job accepted.

**Tech Stack:** TypeScript, Vitest, JDC Context Engine harvest/distiller modules.

---

## File Map

- Modify `packages/core/src/context/types.ts`
  - Add `DistillerBatchOutput`.
  - Include it in `DistillerOutput`.

- Modify `packages/core/src/context/schemas.ts`
  - Add `DistillerBatchOutputSchema`.
  - Include it in `DistillerOutputSchema`.

- Modify `packages/core/src/context/harvest.ts`
  - Detect batch distiller output.
  - Validate/save/reject each fact independently.
  - Preserve single-envelope behavior.

- Modify `packages/core/src/context/context-harvest.test.ts`
  - Add a batch test with one valid fact and one invalid fact.

## Task 1: Batch Output Contract

- [x] **Step 1: Write failing batch harvest test**

Add a test where a distiller returns `{ schemaVersion: 1, distiller, facts: [...] }` with one valid envelope and one invalid envelope.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-harvest.test.ts -t "batch distiller" --no-file-parallelism
```

Expected before implementation: FAIL because the batch object is rejected as an invalid single envelope.

- [x] **Step 3: Add batch output type and schema**

Add `DistillerBatchOutput` and `DistillerBatchOutputSchema`.

- [x] **Step 4: Process batch facts independently**

Update `runHarvestJob()` so each fact in `batch.facts` is validated, converted, and persisted independently.

- [x] **Step 5: Verify GREEN**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-harvest.test.ts -t "batch distiller" --no-file-parallelism
```

Expected: PASS.

## Task 2: Verification

- [x] **Step 1: Run focused tests**

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-harvest.test.ts src/context/context-distillers.test.ts src/context/context-safety.test.ts --no-file-parallelism
```

- [x] **Step 2: Run build**

```bash
pnpm --filter @jdcagnet/core build
```

- [x] **Step 3: Run diff whitespace check**

```bash
git diff --check
```
