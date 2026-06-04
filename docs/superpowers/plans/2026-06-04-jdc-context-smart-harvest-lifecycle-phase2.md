# JDC Context Smart Harvest Lifecycle Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first durable memory lifecycle layer so accepted project facts can be deduplicated, merged, superseded, and kept out of normal retrieval when inactive.

**Architecture:** Extend `ContextFact` with lifecycle metadata and migrate the sql.js schema to v2. Keep lifecycle decisions deterministic in Phase 2: exact canonical duplicates merge; newer facts with an explicit shared canonical key supersede older active facts; `superseded`, `conflicted`, and `archived` facts are excluded by default.

**Tech Stack:** TypeScript, Vitest, sql.js context store, existing JDC Context Engine harvest/store/retrieval modules.

---

## File Map

- Modify `packages/core/src/context/types.ts`
  - Add `ContextFactStatus`.
  - Add lifecycle metadata fields to `ContextFact`.
  - Add lifecycle query fields to `ContextFactQuery` via `store.ts`.

- Modify `packages/core/src/context/schemas.ts`
  - Add `ContextFactStatusSchema`.
  - Validate optional lifecycle metadata.

- Modify `packages/core/src/context/migrations/schema.ts`
  - Bump context store schema from v1 to v2.
  - Add lifecycle columns and indexes to `context_facts`.
  - Support v0 and v1 upgrades to v2.

- Modify `packages/core/src/context/store.ts`
  - Ensure lifecycle columns exist for current-version legacy rows.
  - Default lifecycle status to `active`, or `stale` when freshness is stale.
  - Add default query filtering for inactive lifecycle statuses.
  - Merge duplicate facts with the same canonical identity.
  - Supersede older active facts when a new explicitly keyed fact replaces them.

- Modify `packages/core/src/context/store.test.ts`
  - Add tests for lifecycle migration/defaults, default query filtering, duplicate merge, explicit supersede, and project isolation.

- Modify `packages/core/src/context/context-retriever.test.ts`
  - Add retrieval test proving inactive facts do not enter normal prompt candidates by default.

## Task 1: Lifecycle Schema And Query Defaults

- [x] **Step 1: Write failing store tests**

Add tests that prove:

- legacy rows default to lifecycle `active`;
- stale-freshness rows default to lifecycle `stale`;
- normal `queryFacts()` excludes `superseded`, `conflicted`, and `archived`;
- `queryFacts({ includeInactive: true })` can inspect them;
- `queryFacts({ status: 'superseded', includeInactive: true })` can target a single status.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts -t "lifecycle" --no-file-parallelism
```

Expected: FAIL because lifecycle fields and query filters do not exist yet.

- [x] **Step 3: Implement lifecycle schema and migration**

Add lifecycle fields to `ContextFact`, zod schemas, v2 migration, `ensureProjectIsolationSchema()`, `saveFact()`, `parseFactRow()`, and `selectFacts()`.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts -t "lifecycle" --no-file-parallelism
```

Expected: PASS.

## Task 2: Duplicate Merge And Supersede

- [x] **Step 1: Write failing resolver tests**

Add tests that prove:

- saving the same canonical fact twice keeps one active fact and merges citations/confidence;
- saving a newer fact with the same explicit `canonicalKey` and different content marks the older fact `superseded` and keeps the new fact `active`;
- supersede never crosses project roots when stores share a database path.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts -t "canonical|supersede" --no-file-parallelism
```

Expected: FAIL because save-time lifecycle resolution does not exist yet.

- [x] **Step 3: Implement deterministic resolver in store**

Resolve lifecycle inside `saveFact()` after validation/redaction and before insert:

- compute a stable canonical key;
- merge exact normalized duplicates;
- supersede active facts only when the incoming fact supplied an explicit `canonicalKey`;
- keep superseded facts inspectable but out of default queries.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts -t "canonical|supersede" --no-file-parallelism
```

Expected: PASS.

## Task 3: Retrieval Default Safety

- [x] **Step 1: Write failing retriever test**

Add a test proving `retrieveContextFacts()` does not receive or return superseded/conflicted/archived facts by default.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-retriever.test.ts --no-file-parallelism
```

Expected: FAIL until lifecycle query options are wired through test doubles and store defaults.

- [x] **Step 3: Implement retrieval compatibility**

Keep `retrieveContextFacts()` on normal active retrieval. Do not add default candidate caps.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-retriever.test.ts --no-file-parallelism
```

Expected: PASS.

## Task 4: Focused Verification

- [x] **Step 1: Run focused tests**

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts src/context/context-retriever.test.ts src/context/context-harvest.test.ts --no-file-parallelism
```

- [x] **Step 2: Run build**

```bash
pnpm --filter @jdcagnet/core build
```

- [x] **Step 3: Run diff whitespace check**

```bash
git diff --check
```

- [x] **Step 4: Inspect diff**

Expected: diff only contains Phase 2 lifecycle schema, store resolver, retrieval tests, and roadmap/plan docs.
