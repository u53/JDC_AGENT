# JDC Context Smart Harvest Lifecycle Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a background harvest plan classifier layer so `harvest-router.ts` is no longer treated as the final semantic decision point.

**Architecture:** Keep the router as a cheap fallback decision. Add `HarvestPlan` and a pluggable classifier seam inside `runHarvestJob()`: classifier output selects the distillation lane, and classifier failures fall back to the router without blocking foreground chat.

**Tech Stack:** TypeScript, Vitest, existing JDC Context Engine harvest/distiller modules.

---

## File Map

- Modify `packages/core/src/context/types.ts`
  - Add `HarvestPlan` and `HarvestPlanAction`.

- Create `packages/core/src/context/harvest-classifier.ts`
  - Convert router fallback decisions into harvest plans.
  - Normalize external classifier plans.
  - Pick the highest-priority action for Phase 3.
  - Fall back safely when classifier output fails.

- Modify `packages/core/src/context/harvest.ts`
  - Accept an optional background classifier in `RunHarvestJobOptions`.
  - Use classifier plan decisions before selecting a distiller.
  - Persist classifier failure diagnostics without rejecting foreground chat.

- Modify `packages/core/src/context/context-harvest.test.ts`
  - Prove classifier plans can select project-profile distillation over router fallback.
  - Prove classifier failure falls back to router distillation and records diagnostics.

## Task 1: Harvest Plan Classifier Seam

- [x] **Step 1: Write failing classifier plan test**

Add a harvest test where router fallback would not select `ProjectProfileDistiller`, but an injected classifier returns `distill_project_update`.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-harvest.test.ts -t "background harvest plan classifier" --no-file-parallelism
```

Expected before implementation: FAIL because `runHarvestJob()` ignores classifier plans.

- [x] **Step 3: Implement `HarvestPlan` and classifier integration**

Add `HarvestPlan` types, `harvest-classifier.ts`, and `RunHarvestJobOptions.classifier`.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-harvest.test.ts -t "background harvest plan classifier" --no-file-parallelism
```

Expected: PASS.

## Task 2: Classifier Failure Fallback

- [x] **Step 1: Write fallback test**

Add a harvest test where the classifier throws and router fallback still accepts a memory candidate.

- [x] **Step 2: Implement quiet fallback diagnostics**

Persist a harvest diagnostic when classifier planning fails, then use router fallback.

- [x] **Step 3: Verify GREEN**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-harvest.test.ts --no-file-parallelism
```

Expected: PASS.

## Task 3: Verification

- [x] **Step 1: Run focused context tests**

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-harvest.test.ts src/context/harvest-router.test.ts src/context/context-distillers.test.ts --no-file-parallelism
```

- [x] **Step 2: Run build**

```bash
pnpm --filter @jdcagnet/core build
```

- [x] **Step 3: Run diff whitespace check**

```bash
git diff --check
```
