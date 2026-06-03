# JDC Context Engine V2 Phase 2 Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class provenance metadata to durable JDC Context Engine facts so project knowledge can say who produced it, from which actor/run/session, and which files/symbols/tasks it relates to, without breaking project-level cross-session sharing.

**Architecture:** Extend the existing `ContextFact` contract with optional V2 metadata, add runtime schemas, backfill store rows through the current `ensureSchema()` migration style, and populate origin on new memory-write and harvest facts. Existing query APIs continue to return project-shared facts; provenance is metadata, not an isolation boundary.

**Tech Stack:** TypeScript, Vitest, sql.js, existing `ContextStore`, existing harvest pipeline, existing `JdcMemoryWrite`/`JdcMemorySearch`, project-local `.jdcagnet/context-engine/context.db`.

---

## Phase 2 Scope

This plan implements only Phase 2 from `docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-master-roadmap.md`.

It adds:

- `ContextActor` and `ContextOrigin`;
- optional `origin`, `tags`, `relatedFiles`, `relatedSymbols`, and `relatedTasks` on `ContextFact`;
- runtime schemas for these fields;
- store columns and backfill logic;
- origin population for memory-write facts and harvest facts;
- tests proving legacy rows remain readable and same-project facts remain shared.

It does not implement actor-aware context packs, Team ledger ingestion, workflow producer, UI redesign, or embeddings. Those are later phases and depend on this provenance contract.

## Hard Product Contracts

- Do not rename `JDC Context Engine`.
- Do not move persistence out of `<project>/.jdcagnet/context-engine/context.db`.
- Do not make accepted project facts session-isolated.
- Do not leak facts across project roots.
- Do not store raw hidden reasoning.
- Do not introduce engine token, fact, memory, or retrieval default caps.
- `origin.sessionId`, `origin.teamId`, `origin.memberId`, and `origin.taskId` are provenance fields, not access-control filters.
- Existing context DBs must open and migrate in place.
- Existing accepted facts must remain queryable through `queryFacts()` and `listAcceptedProjectFacts()`.

## File Structure

- Modify: `packages/core/src/context/types.ts`
  - Add `ContextActor`, `ContextOrigin`, and optional V2 metadata fields on `ContextFact`.
  - Add optional `origin?: Partial<ContextOrigin>` to `HarvestCandidate` so sub-session/team paths can pass actor provenance forward before Phase 3/4.
- Modify: `packages/core/src/context/schemas.ts`
  - Add `ContextActorSchema`, `ContextOriginSchema`, string-array helper schema, and extend `ContextFactSchema`.
  - Extend `HarvestCandidateSchema` with optional `origin`.
- Modify: `packages/core/src/context/store.ts`
  - Add `origin_json`, `tags_json`, `related_files_json`, `related_symbols_json`, and `related_tasks_json` columns through `ensureSchema()`.
  - Backfill old rows with `origin.projectKey`, `origin.actor='main_session'`, and existing `session_id`.
  - Store and parse V2 metadata.
- Modify: `packages/core/src/context/migrations/schema.ts`
  - Add V2 columns to `CREATE TABLE IF NOT EXISTS context_facts(...)` for fresh DBs.
  - Keep `CONTEXT_STORE_SCHEMA_VERSION` stable unless the implementation chooses a formal version bump; existing `ensureSchema()` already handles additive columns.
- Modify: `packages/core/src/context/store.test.ts`
  - Add migration/backfill tests and new metadata persistence tests.
- Modify: `packages/core/src/tools/memory-write.ts`
  - Populate `origin` for explicit memory writes.
  - Pass `cwd` into fact construction so `origin.projectKey` is project-local.
- Modify: `packages/core/src/tools/memory-search.ts`
  - Keep public payload schema unchanged, but do not drop `origin` internally from returned facts before mapping.
  - No default search limit may be introduced.
- Modify: `packages/core/src/tools/memory-tools.test.ts`
  - Assert memory-write facts include origin while search payload remains backward compatible.
- Modify: `packages/core/src/context/harvest.ts`
  - Populate `origin` on facts derived from distiller envelopes.
- Modify: `packages/core/src/context/context-harvest.test.ts`
  - Assert accepted harvest facts carry origin with actor/session/run/model provenance.
- Modify: `packages/core/src/session.ts`
  - Add `origin.actor='main_session'` to main runLoop harvest candidates.
- Modify: `packages/core/src/sub-session.ts`
  - Add `origin.actor='subagent'` to sub-session harvest candidates.
- Modify: `packages/core/src/context/context-product-evals.test.ts`
  - Add eval proving migrated/created provenance does not break same-project cross-session sharing.
- Modify: `packages/core/src/context/evals/assertions.ts`
  - Add provenance-related tests to Gate F command if needed.

## Dependencies

Tasks must be done in order:

1. Types and schemas.
2. Store columns, parse/write, and migration/backfill.
3. Memory-write provenance.
4. Harvest provenance from main/sub-session candidates.
5. Product evals and final verification.

Do not start Task 3 before Task 2 passes. Do not update harvest before store can persist origin.

---

### Task 1: Add Provenance Types And Runtime Schemas

**Files:**
- Modify: `packages/core/src/context/types.ts`
- Modify: `packages/core/src/context/schemas.ts`
- Test: `packages/core/src/context/store.test.ts`

- [ ] **Step 1: Write failing schema/type persistence-facing test**

Add this test near the other fact persistence tests in `packages/core/src/context/store.test.ts`:

```ts
  it('validates provenance and related metadata on context facts', async () => {
    const projectDir = makeTempDir()
    const store = await openContextStore({ cwd: projectDir, now: () => 1_000 })
    await saveFileEvidence(store, { cwd: projectDir })

    const fact = makeFact({
      id: 'fact_with_origin',
      sessionId: 'session_a',
      origin: {
        projectKey: projectDir,
        actor: 'main_session',
        sessionId: 'session_a',
        runLoopId: 'run_1',
        providerProtocol: 'anthropic',
        modelId: 'claude-opus-4-5',
      },
      tags: ['release', 'workflow'],
      relatedFiles: ['package.json', '.github/workflows/release.yml'],
      relatedSymbols: ['runRelease'],
      relatedTasks: ['task_release'],
    })

    await expectOk(store.saveFact(fact))

    const saved = (await store.queryFacts()).value[0]!
    expect(saved.origin).toEqual(fact.origin)
    expect(saved.tags).toEqual(['release', 'workflow'])
    expect(saved.relatedFiles).toEqual(['package.json', '.github/workflows/release.yml'])
    expect(saved.relatedSymbols).toEqual(['runRelease'])
    expect(saved.relatedTasks).toEqual(['task_release'])
  })
```

- [ ] **Step 2: Run test to verify red**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts --no-file-parallelism
```

Expected: FAIL because `ContextFact` and `ContextFactSchema` do not accept `origin`, `tags`, `relatedFiles`, `relatedSymbols`, or `relatedTasks`.

- [ ] **Step 3: Add TypeScript types**

In `packages/core/src/context/types.ts`, add after `ContextProviderStatus`:

```ts
export type ContextActor = 'main_session' | 'subagent' | 'team_pm' | 'team_worker' | 'system' | 'user'

export interface ContextOrigin {
  projectKey: string
  actor: ContextActor
  sessionId?: string
  runLoopId?: string
  subSessionId?: string
  teamId?: string
  memberId?: string
  taskId?: string
  artifactId?: string
  toolUseId?: string
  messageId?: string
  providerProtocol?: ProviderProtocol
  modelId?: string
}
```

Extend `ContextFact`:

```ts
  origin?: ContextOrigin
  tags?: string[]
  relatedFiles?: string[]
  relatedSymbols?: string[]
  relatedTasks?: string[]
```

Extend `HarvestCandidate`:

```ts
  origin?: Partial<ContextOrigin>
```

- [ ] **Step 4: Add runtime schemas**

In `packages/core/src/context/schemas.ts`, add:

```ts
export const ContextActorSchema = z.enum(['main_session', 'subagent', 'team_pm', 'team_worker', 'system', 'user'])

export const ContextOriginSchema = z.object({
  projectKey: nonEmptyStringSchema,
  actor: ContextActorSchema,
  sessionId: z.string().optional(),
  runLoopId: z.string().optional(),
  subSessionId: z.string().optional(),
  teamId: z.string().optional(),
  memberId: z.string().optional(),
  taskId: z.string().optional(),
  artifactId: z.string().optional(),
  toolUseId: z.string().optional(),
  messageId: z.string().optional(),
  providerProtocol: ProviderProtocolSchema.optional(),
  modelId: z.string().optional(),
})

const stringListSchema = z.array(nonEmptyStringSchema).default([])
```

Extend `ContextFactSchema`:

```ts
  origin: ContextOriginSchema.optional(),
  tags: stringListSchema.optional(),
  relatedFiles: stringListSchema.optional(),
  relatedSymbols: stringListSchema.optional(),
  relatedTasks: stringListSchema.optional(),
```

Extend `HarvestCandidateSchema`:

```ts
  origin: ContextOriginSchema.partial().optional(),
```

- [ ] **Step 5: Run schema-facing tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts --no-file-parallelism
```

Expected: still FAIL until store columns parse/write V2 metadata.

- [ ] **Step 6: Commit types/schema when tests are red for store only**

```bash
git add packages/core/src/context/types.ts packages/core/src/context/schemas.ts packages/core/src/context/store.test.ts
git commit -m "test(context): specify fact provenance metadata"
```

---

### Task 2: Persist And Backfill Provenance In ContextStore

**Files:**
- Modify: `packages/core/src/context/store.ts`
- Modify: `packages/core/src/context/migrations/schema.ts`
- Modify: `packages/core/src/context/store.test.ts`

- [ ] **Step 1: Add failing legacy migration test**

Add this test in `packages/core/src/context/store.test.ts`:

```ts
  it('backfills origin for legacy context facts without session isolation', async () => {
    const projectDir = makeTempDir()
    const dbPath = makeDbPath()
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    db.run(`CREATE TABLE schema_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    db.run(`INSERT INTO schema_meta(key, value) VALUES('context_schema_version', '1')`)
    db.run(`CREATE TABLE context_facts(
      id TEXT PRIMARY KEY,
      project_key TEXT,
      fact_id TEXT,
      kind TEXT NOT NULL,
      scope TEXT NOT NULL,
      content TEXT NOT NULL,
      citations_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      freshness TEXT NOT NULL,
      source_provider TEXT NOT NULL,
      session_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER
    )`)
    db.run(`CREATE TABLE raw_evidence(
      id TEXT PRIMARY KEY,
      project_key TEXT,
      evidence_id TEXT,
      session_id TEXT NOT NULL,
      cwd TEXT NOT NULL,
      source_provider TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      hash TEXT NOT NULL
    )`)
    db.run(`INSERT INTO raw_evidence(id, project_key, evidence_id, session_id, cwd, source_provider, kind, content, metadata_json, captured_at, hash)
      VALUES('raw_legacy', ?, 'raw_legacy', 'session_legacy', ?, 'Legacy', 'file', 'legacy file', ?, 1, 'hash_1')`, [
      projectDir,
      projectDir,
      JSON.stringify({ file: 'src/file.ts' }),
    ])
    db.run(`INSERT INTO context_facts(id, project_key, fact_id, kind, scope, content, citations_json, confidence, freshness, source_provider, session_id, created_at, updated_at, expires_at)
      VALUES('fact_legacy', ?, 'fact_legacy', 'workflow_rule', 'project', 'Legacy release rule', ?, 0.9, 'recent', 'LegacyProvider', 'session_legacy', 1, 1, NULL)`, [
      projectDir,
      JSON.stringify([citation]),
    ])
    writeFileSync(dbPath, Buffer.from(db.export()))
    db.close()

    const store = await openContextStore({ dbPath, cwd: projectDir, now: () => 2_000 })
    const facts = await store.listAcceptedProjectFacts()

    expect(facts.value).toMatchObject([{
      id: 'fact_legacy',
      sessionId: 'session_legacy',
      origin: {
        projectKey: projectDir,
        actor: 'main_session',
        sessionId: 'session_legacy',
      },
    }])

    const sameProjectOtherSession = await openContextStore({ dbPath, cwd: path.join(projectDir, '.'), now: () => 3_000 })
    expect((await sameProjectOtherSession.listAcceptedProjectFacts()).value.map((fact) => fact.id)).toEqual(['fact_legacy'])
  })
```

- [ ] **Step 2: Run store tests to verify red**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts --no-file-parallelism
```

Expected: FAIL because columns and backfill do not exist.

- [ ] **Step 3: Add fresh DB columns**

In `packages/core/src/context/migrations/schema.ts`, extend `context_facts`:

```sql
    origin_json TEXT,
    tags_json TEXT,
    related_files_json TEXT,
    related_symbols_json TEXT,
    related_tasks_json TEXT
```

Do not remove old `session_id`.

- [ ] **Step 4: Add additive columns in ensureSchema**

In `packages/core/src/context/store.ts`, extend `ensureProjectIsolationSchema()`:

```ts
  ensureColumn(db, 'context_facts', 'origin_json', 'TEXT')
  ensureColumn(db, 'context_facts', 'tags_json', 'TEXT')
  ensureColumn(db, 'context_facts', 'related_files_json', 'TEXT')
  ensureColumn(db, 'context_facts', 'related_symbols_json', 'TEXT')
  ensureColumn(db, 'context_facts', 'related_tasks_json', 'TEXT')
```

After `backfillProjectIsolationRows(...)`, call:

```ts
  backfillFactProvenanceRows(db, projectKey)
```

Add helper:

```ts
function backfillFactProvenanceRows(db: Database, fallbackProjectKey: string): void {
  for (const row of selectDbRows(db, 'SELECT id, project_key, session_id, origin_json FROM context_facts WHERE origin_json IS NULL OR origin_json = ?', [''])) {
    const id = String(row.id)
    const projectKey = stringOrUndefined(row.project_key) ?? fallbackProjectKey
    const sessionId = stringOrUndefined(row.session_id)
    const origin = {
      projectKey,
      actor: 'main_session',
      ...(sessionId ? { sessionId } : {}),
    }
    db.run('UPDATE context_facts SET origin_json = ? WHERE id = ?', [JSON.stringify(origin), id])
  }
}
```

- [ ] **Step 5: Store V2 metadata in saveFact**

In `SqlJsContextStore.saveFact()`, before `this.db.run(...)`, build:

```ts
      const origin = parsed.data.origin ?? defaultOriginForFact(parsed.data, this.projectKey)
      const tags = parsed.data.tags ?? []
      const relatedFiles = parsed.data.relatedFiles ?? []
      const relatedSymbols = parsed.data.relatedSymbols ?? []
      const relatedTasks = parsed.data.relatedTasks ?? []
```

Change the insert statement to include:

```sql
origin_json, tags_json, related_files_json, related_symbols_json, related_tasks_json
```

Add values:

```ts
JSON.stringify(origin),
JSON.stringify(tags),
JSON.stringify(relatedFiles),
JSON.stringify(relatedSymbols),
JSON.stringify(relatedTasks),
```

Add helper:

```ts
function defaultOriginForFact(fact: ContextFact, projectKey: string): ContextOrigin {
  return {
    projectKey,
    actor: 'main_session',
    ...(fact.sessionId ? { sessionId: fact.sessionId } : {}),
  }
}
```

Import `ContextOrigin` from `./types.js`.

- [ ] **Step 6: Parse V2 metadata**

Update `parseFactRow()`:

```ts
    origin: parseJsonColumn(row.origin_json, undefined),
    tags: parseStringArrayColumn(row.tags_json),
    relatedFiles: parseStringArrayColumn(row.related_files_json),
    relatedSymbols: parseStringArrayColumn(row.related_symbols_json),
    relatedTasks: parseStringArrayColumn(row.related_tasks_json),
```

Add helpers:

```ts
function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback
  try {
    return JSON.parse(String(value)) as T
  } catch {
    return fallback
  }
}

function parseStringArrayColumn(value: unknown): string[] | undefined {
  const parsed = parseJsonColumn<unknown>(value, undefined)
  if (!Array.isArray(parsed)) return undefined
  const strings = parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
  return strings.length ? strings : []
}
```

- [ ] **Step 7: Run store tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 8: Commit store provenance migration**

```bash
git add packages/core/src/context/store.ts packages/core/src/context/migrations/schema.ts packages/core/src/context/store.test.ts
git commit -m "feat(context): persist fact provenance metadata"
```

---

### Task 3: Populate Provenance For JdcMemoryWrite

**Files:**
- Modify: `packages/core/src/tools/memory-write.ts`
- Modify: `packages/core/src/tools/memory-tools.test.ts`

- [ ] **Step 1: Add failing memory-write origin test**

Add to `packages/core/src/tools/memory-tools.test.ts`:

```ts
  it('writes explicit memory with user provenance in the project origin', async () => {
    const store = makeStore()

    const payload = await writeMemoryRecord({
      kind: 'workflow_hint',
      content: 'Run pnpm build before release.',
      citation: '用户明确要求保存这条发布规则。',
      confidence: 0.9,
    }, { store, cwd: '/repo', now: () => 4_000 })

    expect(payload.status).toBe('accepted')
    expect(store.saveFact).toHaveBeenCalledWith(expect.objectContaining({
      origin: expect.objectContaining({
        projectKey: '/repo',
        actor: 'user',
      }),
    }))
  })
```

- [ ] **Step 2: Run memory tests to verify red**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/tools/memory-tools.test.ts --no-file-parallelism
```

Expected: FAIL because memory writes do not set origin.

- [ ] **Step 3: Pass cwd into fact construction**

Change:

```ts
  const fact = factFromMemoryInput(parsed.data, writtenAt)
```

to:

```ts
  const fact = factFromMemoryInput(parsed.data, writtenAt, options.cwd)
```

Change signature:

```ts
function factFromMemoryInput(input: MemoryWriteInput, now: number, cwd: string | undefined): ContextFact
```

- [ ] **Step 4: Add memory origin helper**

In `packages/core/src/tools/memory-write.ts`, import `path`:

```ts
import path from 'node:path'
```

Add:

```ts
function memoryWriteOrigin(input: MemoryWriteInput, cwd: string | undefined): ContextFact['origin'] {
  const actor = input.citations.some((citation) => citation.type === 'message') ? 'user' : 'main_session'
  return {
    projectKey: path.resolve(cwd ?? process.cwd()),
    actor,
  }
}
```

Set on returned fact:

```ts
    origin: memoryWriteOrigin(input, cwd),
```

- [ ] **Step 5: Run memory tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/tools/memory-tools.test.ts src/context/store.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Commit memory write provenance**

```bash
git add packages/core/src/tools/memory-write.ts packages/core/src/tools/memory-tools.test.ts
git commit -m "feat(context): add memory write provenance"
```

---

### Task 4: Populate Provenance For Main And Sub-Session Harvest

**Files:**
- Modify: `packages/core/src/context/harvest.ts`
- Modify: `packages/core/src/context/context-harvest.test.ts`
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/sub-session.ts`

- [ ] **Step 1: Add failing harvest origin test**

Add to `packages/core/src/context/context-harvest.test.ts`:

```ts
  it('persists accepted harvest facts with candidate and model provenance', async () => {
    const store = makeHarvestStore()
    const job = makeHarvestJob({
      sessionId: 'session_a',
      runLoopId: 'run_a',
      candidate: makeHarvestCandidate({
        sessionId: 'session_a',
        runLoopId: 'run_a',
        origin: {
          projectKey: '/repo',
          actor: 'main_session',
          sessionId: 'session_a',
          runLoopId: 'run_a',
        },
      }),
      modelBinding: {
        sessionId: 'session_a',
        providerProtocol: 'anthropic',
        modelId: 'claude-opus-4-5',
        modelConfig: { model: 'claude-opus-4-5', maxTokens: 1_000 },
      },
    })

    await runHarvestJob(job, {
      store,
      modelClient: async () => ({
        schemaVersion: 1,
        distiller: 'MemoryCuratorDistiller',
        confidence: 0.96,
        citations: [{ id: 'cit_run_user', type: 'message', ref: 'run_a:user' }],
        payload: {
          kind: 'workflow_hint',
          scope: 'project',
          content: 'Run pnpm build before release.',
          confidence: 0.96,
        },
      }),
      minConfidence: 0.8,
      trustMode: 'auto_accept_high_confidence',
    })

    expect(store.saveFact).toHaveBeenCalledWith(expect.objectContaining({
      origin: expect.objectContaining({
        projectKey: '/repo',
        actor: 'main_session',
        sessionId: 'session_a',
        runLoopId: 'run_a',
        providerProtocol: 'anthropic',
        modelId: 'claude-opus-4-5',
      }),
    }))
  })
```

Use existing helper names in `context-harvest.test.ts`. If the current file uses different helper names, adapt only helper references, not the expected origin contract.

- [ ] **Step 2: Run harvest tests to verify red**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-harvest.test.ts --no-file-parallelism
```

Expected: FAIL because harvest facts do not set origin.

- [ ] **Step 3: Merge candidate and model provenance in harvest**

In `packages/core/src/context/harvest.ts`, update `factFromAcceptedEnvelope()`:

```ts
    origin: {
      projectKey: job.candidate.origin?.projectKey ?? job.candidate.changedFiles[0] ?? 'unknown',
      actor: job.candidate.origin?.actor ?? 'main_session',
      sessionId: job.candidate.origin?.sessionId ?? job.sessionId,
      runLoopId: job.candidate.origin?.runLoopId ?? job.runLoopId,
      subSessionId: job.candidate.origin?.subSessionId,
      teamId: job.candidate.origin?.teamId,
      memberId: job.candidate.origin?.memberId,
      taskId: job.candidate.origin?.taskId,
      providerProtocol: job.modelBinding.providerProtocol,
      modelId: job.modelBinding.modelId,
    },
```

Do not use `changedFiles[0]` as the final implementation if `projectKey` can be passed from session/sub-session; it is only a defensive fallback. The required session/sub-session changes below must pass `projectKey`.

- [ ] **Step 4: Pass main-session origin into harvest candidates**

In `packages/core/src/session.ts`, inside `enqueueHarvestAfterRunLoop()`, add to the `candidate` object:

```ts
      origin: {
        projectKey: this.config.cwd,
        actor: 'main_session',
        sessionId: this.id,
        runLoopId: input.runLoopId,
      },
```

If `this.config.cwd` can be relative in this file, normalize it with `path.resolve(this.config.cwd)`.

- [ ] **Step 5: Pass subagent origin into harvest candidates**

In `packages/core/src/sub-session.ts`, inside `enqueueSubSessionHarvest()`, add to the `candidate` object:

```ts
    origin: {
      projectKey: opts.cwd,
      actor: 'subagent',
      sessionId: contextSessionId,
      runLoopId,
      subSessionId: runLoopId,
    },
```

Do not infer Team PM/worker here yet. Phase 3/4 will pass `teamId`, `memberId`, and `taskId` through actor-aware context profiles and Team ledger producers.

- [ ] **Step 6: Run harvest/session tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-harvest.test.ts src/session-context.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 7: Commit harvest provenance**

```bash
git add packages/core/src/context/harvest.ts packages/core/src/context/context-harvest.test.ts packages/core/src/session.ts packages/core/src/sub-session.ts
git commit -m "feat(context): add harvest fact provenance"
```

---

### Task 5: Product Evals, Public Compatibility, And Final Verification

**Files:**
- Modify: `packages/core/src/context/context-product-evals.test.ts`
- Modify: `packages/core/src/context/evals/assertions.ts`
- Optional Modify: `packages/core/src/tools/memory-search.ts`
- Optional Modify: `packages/core/src/tools/memory-tools.test.ts`

- [ ] **Step 1: Add product eval for provenance without session isolation**

Add to `packages/core/src/context/context-product-evals.test.ts`:

```ts
  it('keeps provenance metadata while sharing accepted project facts across sessions', async () => {
    const cwd = tempProject()
    const storeA = await openContextStore({ cwd, now: () => 1_000 })
    await storeA.saveRawEvidence({
      id: 'raw_provenance_rule',
      sessionId: 'session_a',
      cwd,
      sourceProvider: 'ProductEval',
      kind: 'message',
      content: '记住：发布前必须跑 pnpm build。',
      metadata: { messageId: 'session_a/provenance_rule' },
      capturedAt: 1_000,
      hash: 'hash_provenance_rule',
    })
    await storeA.saveFact({
      id: 'project_rule_with_origin',
      kind: 'workflow_rule',
      scope: 'project',
      content: '发布前必须跑 pnpm build。',
      citations: [{ id: 'cit_provenance_rule', type: 'message', ref: 'session_a/provenance_rule' }],
      confidence: 0.95,
      freshness: 'recent',
      sourceProvider: 'ProductEval',
      sessionId: 'session_a',
      origin: {
        projectKey: cwd,
        actor: 'user',
        sessionId: 'session_a',
        messageId: 'session_a/provenance_rule',
      },
      tags: ['release'],
      relatedFiles: ['package.json'],
      relatedSymbols: [],
      relatedTasks: [],
      createdAt: 1_000,
      updatedAt: 1_000,
    })

    const storeB = await openContextStore({ cwd, now: () => 2_000 })
    const facts = await storeB.listAcceptedProjectFacts()

    expect(facts.value).toMatchObject([{
      id: 'project_rule_with_origin',
      sessionId: 'session_a',
      origin: {
        projectKey: cwd,
        actor: 'user',
        sessionId: 'session_a',
        messageId: 'session_a/provenance_rule',
      },
      tags: ['release'],
      relatedFiles: ['package.json'],
    }])
  })
```

- [ ] **Step 2: Keep `JdcMemorySearch` public schema compatible**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/tools/memory-tools.test.ts --no-file-parallelism
```

Expected: PASS without adding `origin` to `MemorySearchResultSchema`.

If a future implementation chooses to expose origin, add a separate optional `origin` field and update UI/tool contracts. Phase 2 default is internal provenance only.

- [ ] **Step 3: Add provenance tests to Gate F command**

In `packages/core/src/context/evals/assertions.ts`, ensure `GATE_F_CONTEXT_EVAL_COMMAND` contains:

```text
src/context/store.test.ts
src/context/context-harvest.test.ts
src/tools/memory-tools.test.ts
src/context/context-product-evals.test.ts
```

These are already present in most current versions; only edit if one is missing.

- [ ] **Step 4: Run Phase 2 verification suite**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts src/tools/memory-tools.test.ts src/context/context-harvest.test.ts src/context/context-product-evals.test.ts src/session-context.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 5: Run global context smoke suite**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-config.test.ts src/context/context-retriever.test.ts src/context/context-orchestrator.test.ts src/context/signal-providers.test.ts src/providers/provider-prompt-contract.test.ts src/context/context-product-evals.test.ts src/tools/memory-tools.test.ts src/session-context.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Run build and diff checks**

Run:

```bash
pnpm --filter @jdcagnet/core build
git diff --check
```

Expected: both pass.

- [ ] **Step 7: Commit eval/verification updates**

```bash
git add packages/core/src/context/context-product-evals.test.ts packages/core/src/context/evals/assertions.ts packages/core/src/tools/memory-search.ts packages/core/src/tools/memory-tools.test.ts
git commit -m "test(context): cover provenance compatibility"
```

If `memory-search.ts` or `memory-tools.test.ts` were not changed, omit them from `git add`.

---

## Final Acceptance Checklist

- [ ] `ContextFact` supports optional provenance and related metadata.
- [ ] Runtime schema validates provenance and related metadata.
- [ ] Fresh DBs include provenance columns.
- [ ] Existing DBs add provenance columns through `ensureSchema()`.
- [ ] Legacy rows get `origin.projectKey`, `origin.actor='main_session'`, and existing `sessionId`.
- [ ] New `saveFact()` writes origin JSON and related metadata JSON.
- [ ] `parseFactRow()` reads origin and related metadata.
- [ ] `JdcMemoryWrite` sets `origin.actor='user'` for message-cited explicit memories.
- [ ] Harvest accepted facts set origin with actor/session/run/model provenance.
- [ ] Sub-session harvest facts set `origin.actor='subagent'`.
- [ ] Same-project cross-session sharing still works.
- [ ] Different projects still do not share facts.
- [ ] No new token/fact/memory default cap is introduced.
- [ ] Public `JdcMemorySearch` payload remains backward compatible.

## Final Verification Commands

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts src/tools/memory-tools.test.ts src/context/context-harvest.test.ts src/context/context-product-evals.test.ts src/session-context.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core exec vitest run src/context/context-config.test.ts src/context/context-retriever.test.ts src/context/context-orchestrator.test.ts src/context/signal-providers.test.ts src/providers/provider-prompt-contract.test.ts src/context/context-product-evals.test.ts src/tools/memory-tools.test.ts src/session-context.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core build
git diff --check
```
