# JDC Agent Constraint Engine Phase 8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a model-generated Repo Wiki that summarizes the repository with file-backed citations, invalidates when cited files change, participates in context retrieval, and remains visible through Chinese-first context/debug UI.

**Architecture:** Build Repo Wiki as a project-scoped, DB-backed, model-generated derived layer. The foreground provider only reads accepted wiki entries and schedules background refresh work; background generation assembles bounded evidence packets from the existing code index, repo map, docs, and package scripts, asks the active model for strict JSON, validates every section citation against source file hashes, then stores accepted entries. Current files and live code evidence remain authoritative over wiki content.

**Tech Stack:** TypeScript, Vitest, sql.js context store, zod schemas, existing `ContextScheduler`, existing context provider/orchestrator pipeline, existing provider chat interface, React/Zustand Context panel.

---

## Source Documents

- Design: `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`
- Phase 7 plan: `docs/superpowers/plans/2026-06-07-jdc-agent-constraint-engine-phase7.md`
- Evidence-first retention plan: `docs/superpowers/plans/2026-06-07-evidence-first-tool-retention.md`

## Scope

This plan covers Phase 8 only:

- model-generated Repo Wiki entries from indexed code, repository docs, and package scripts;
- strict output schema for Wiki generation;
- citation and file-hash validation before persistence;
- project-scoped context store migration and quotas for Wiki rows;
- background refresh scheduling through `ContextScheduler`;
- `repo_wiki` context provider and retrieval ranking;
- stale Wiki invalidation when cited files change;
- Context Inspect and Chinese-first UI/debug visibility;
- product evals and design document update.

This plan does not implement:

- user-authored Wiki editing;
- raw hidden reasoning storage;
- uncited model summaries;
- automatic command execution for Wiki refresh;
- a separate filesystem Wiki under `.jdcagnet/context-engine/repo-wiki`;
- treating Wiki entries as more authoritative than current file reads, current code index, or fresh code provider sections.

## Key Design Decisions

1. **Model-generated, evidence-limited:** The model writes Wiki sections, but it only receives an evidence packet assembled by product code. The model must cite packet ids that map back to real files and current hashes.
2. **DB-backed storage:** Use `repo_wiki_entries` in the existing context DB. Do not write generated Markdown files into the repo.
3. **Hard validation before storage:** Reject model output when a section has no citations, cites an unknown packet id, cites a file with a stale hash, includes hidden reasoning markers, or exceeds section size limits.
4. **Derived authority:** Wiki sections use `ownership.authority = 'derived_state'`, `topic = 'code'`, and `conflictPolicy = 'render'`. Code provider `relevant_code` and fresh file reads outrank Wiki.
5. **Foreground stays fast:** The `repo_wiki` provider reads stored rows and queues generation when rows are missing or stale. It does not block context injection on model generation.
6. **Chinese-first UI:** User-facing labels say `仓库 Wiki`. Literal paths, provider ids, model ids, and commands stay as-is.

## File Boundary Map

Create:

- `packages/core/src/context/repo-wiki/types.ts` - Repo Wiki entry, evidence packet, model output, query, and summary types.
- `packages/core/src/context/repo-wiki/schemas.ts` - zod schemas for generated output and persisted rows.
- `packages/core/src/context/repo-wiki/evidence.ts` - Build model evidence packets from `buildRepoMap()`, indexed files, docs, package scripts, and file hashes.
- `packages/core/src/context/repo-wiki/model-client.ts` - Provider-backed model call helper for Repo Wiki generation.
- `packages/core/src/context/repo-wiki/generator.ts` - Generate, parse, validate, and persist Repo Wiki entries.
- `packages/core/src/context/repo-wiki/provider.ts` - Context provider that retrieves Wiki entries and schedules refresh.
- `packages/core/src/context/repo-wiki/retrieval.ts` - Score Wiki entries for user message and evidence requirements.
- `packages/core/src/context/repo-wiki/index.ts` - Public exports for provider and generator.
- `packages/core/src/context/repo-wiki/repo-wiki.test.ts` - Generator, validation, and retrieval tests.
- `packages/core/src/context/providers/repo-wiki-provider.test.ts` - Provider scheduling and section rendering tests.

Modify:

- `packages/core/src/context/types.ts`
- `packages/core/src/context/schemas.ts`
- `packages/core/src/context/config.ts`
- `packages/core/src/context/migrations/schema.ts`
- `packages/core/src/context/store.ts`
- `packages/core/src/context/store.test.ts`
- `packages/core/src/context/providers/index.ts`
- `packages/core/src/context/orchestrator.ts`
- `packages/core/src/context/context-orchestrator.test.ts`
- `packages/core/src/context/context-product-evals.test.ts`
- `packages/core/src/session.ts`
- `packages/core/src/session-context.test.ts`
- `packages/core/src/tools/context-inspect.ts`
- `packages/core/src/tools/context-tools.test.ts`
- `packages/core/src/index.ts`
- `packages/ui/src/components/context/ContextPanelPrimitives.tsx`
- `packages/ui/src/components/context/ContextCurrentPanel.tsx`
- `packages/ui/src/components/context/ContextAdvancedDiagnosticsPanel.tsx`
- `packages/ui/src/components/context/context-panels.test.tsx`
- `packages/ui/src/stores/context-store.test.tsx`
- `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`

## Global Acceptance Gates

Run after the final task:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/repo-wiki/repo-wiki.test.ts src/context/providers/repo-wiki-provider.test.ts src/context/store.test.ts src/context/context-orchestrator.test.ts src/context/context-product-evals.test.ts src/tools/context-tools.test.ts src/session-context.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core build
pnpm --filter @jdcagnet/ui exec vitest run src/components/context/context-panels.test.tsx src/stores/context-store.test.tsx --no-file-parallelism
pnpm --filter @jdcagnet/ui build
git diff --check
```

Expected final result: all commands pass.

---

## Task 1: Repo Wiki Types, Schemas, and Store Migration

**Goal:** Add durable project-scoped storage and runtime types for generated Wiki entries before implementing generation.

**Files:**

- Create: `packages/core/src/context/repo-wiki/types.ts`
- Create: `packages/core/src/context/repo-wiki/schemas.ts`
- Modify: `packages/core/src/context/types.ts`
- Modify: `packages/core/src/context/schemas.ts`
- Modify: `packages/core/src/context/config.ts`
- Modify: `packages/core/src/context/migrations/schema.ts`
- Modify: `packages/core/src/context/store.ts`
- Modify: `packages/core/src/context/store.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add failing store tests**

Append these tests to `packages/core/src/context/store.test.ts`:

```ts
import type { RepoWikiEntry } from './repo-wiki/types.js'

function repoWikiEntry(overrides: Partial<RepoWikiEntry> = {}): RepoWikiEntry {
  return {
    id: overrides.id ?? 'wiki_architecture',
    projectKey: overrides.projectKey ?? '/repo',
    kind: overrides.kind ?? 'architecture',
    title: overrides.title ?? 'Architecture overview',
    content: overrides.content ?? 'Core orchestration lives in session and context modules.',
    citations: overrides.citations ?? [{
      id: 'cit_session',
      type: 'file',
      ref: 'packages/core/src/session.ts',
      line: 1,
      hash: 'hash_session_v1',
    }],
    relatedFiles: overrides.relatedFiles ?? ['packages/core/src/session.ts'],
    relatedSymbols: overrides.relatedSymbols ?? ['Session'],
    confidence: overrides.confidence ?? 0.91,
    freshness: overrides.freshness ?? 'cached',
    generatedBy: overrides.generatedBy ?? {
      providerProtocol: 'anthropic',
      modelId: 'claude-sonnet-4',
      modelProfileId: 'standard',
    },
    evidenceHash: overrides.evidenceHash ?? 'evidence_hash_v1',
    status: overrides.status ?? 'active',
    createdAt: overrides.createdAt ?? 1_700_000_000_000,
    updatedAt: overrides.updatedAt ?? 1_700_000_000_000,
  }
}

it('saves, lists, and project-isolates repo wiki entries', async () => {
  const dbPath = makeDbPath()
  const repoA = await openContextStore({ dbPath, cwd: '/repo-a', now: () => 1_700_000_000_000 })
  const repoB = await openContextStore({ dbPath, cwd: '/repo-b', now: () => 1_700_000_000_100 })

  await expect(repoA.saveRepoWikiEntries([repoWikiEntry({ projectKey: '/repo-a' })])).resolves.toMatchObject({ ok: true })
  await expect(repoB.saveRepoWikiEntries([repoWikiEntry({
    id: 'wiki_other',
    projectKey: '/repo-b',
    title: 'Other repo',
    citations: [{ id: 'cit_other', type: 'file', ref: 'README.md', hash: 'hash_other' }],
    relatedFiles: ['README.md'],
  })])).resolves.toMatchObject({ ok: true })

  const aEntries = await repoA.listRepoWikiEntries()
  const bEntries = await repoB.listRepoWikiEntries()

  expect(aEntries.value.map((entry) => entry.id)).toEqual(['wiki_architecture'])
  expect(bEntries.value.map((entry) => entry.id)).toEqual(['wiki_other'])
})

it('invalidates repo wiki entries when a cited file hash changes', async () => {
  const store = await openContextStore({ dbPath: makeDbPath(), cwd: '/repo', now: () => 1_700_000_000_000 })
  await store.saveRepoWikiEntries([repoWikiEntry({ projectKey: '/repo' })])

  const result = await store.invalidateRepoWikiByFileHash('packages/core/src/session.ts', 'hash_session_v2')
  const entries = await store.listRepoWikiEntries({ includeStale: true })

  expect(result).toMatchObject({ ok: true, value: { invalidatedEntries: 1 } })
  expect(entries.value[0]).toMatchObject({ freshness: 'stale', status: 'stale' })
})

it('excludes stale repo wiki entries unless includeStale is true', async () => {
  const store = await openContextStore({ dbPath: makeDbPath(), cwd: '/repo', now: () => 1_700_000_000_000 })
  await store.saveRepoWikiEntries([repoWikiEntry({ projectKey: '/repo', freshness: 'stale', status: 'stale' })])

  await expect(store.listRepoWikiEntries()).resolves.toMatchObject({ ok: true, value: [] })
  await expect(store.listRepoWikiEntries({ includeStale: true })).resolves.toMatchObject({
    ok: true,
    value: [expect.objectContaining({ id: 'wiki_architecture' })],
  })
})
```

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts --no-file-parallelism
```

Expected: FAIL because `RepoWikiEntry`, `saveRepoWikiEntries`, `listRepoWikiEntries`, and `invalidateRepoWikiByFileHash` do not exist.

- [ ] **Step 2: Add core types**

Create `packages/core/src/context/repo-wiki/types.ts`:

```ts
import type { ContextCitation, ContextFreshness, ContextProviderStatus } from '../types.js'

export type RepoWikiEntryKind = 'architecture' | 'module_boundary' | 'entrypoint' | 'workflow' | 'testing' | 'convention' | 'release' | 'constraint'
export type RepoWikiEntryStatus = 'active' | 'stale' | 'archived' | 'rejected'

export interface RepoWikiGeneratedBy {
  providerProtocol: string
  modelId: string
  modelProfileId?: string
}

export interface RepoWikiEntry {
  id: string
  projectKey: string
  kind: RepoWikiEntryKind
  title: string
  content: string
  citations: ContextCitation[]
  relatedFiles: string[]
  relatedSymbols: string[]
  confidence: number
  freshness: ContextFreshness
  generatedBy: RepoWikiGeneratedBy
  evidenceHash: string
  status: RepoWikiEntryStatus
  createdAt: number
  updatedAt: number
  archivedAt?: number
  lifecycleReason?: string
}

export interface RepoWikiEntryQuery {
  kinds?: RepoWikiEntryKind[]
  includeStale?: boolean
  includeArchived?: boolean
  relatedFile?: string
  relatedSymbol?: string
  limit?: number
}

export interface RepoWikiSummary {
  activeEntries: number
  staleEntries: number
  lastGeneratedAt?: number
  lastModelId?: string
  lastDiagnostic?: string
}

export interface RepoWikiInvalidationResult {
  invalidatedEntries: number
}

export interface RepoWikiEvidencePacket {
  id: string
  ref: string
  title: string
  content: string
  hash: string
  line?: number
  relatedSymbols: string[]
}

export interface RepoWikiModelSection {
  kind: RepoWikiEntryKind
  title: string
  content: string
  citationPacketIds: string[]
  relatedFiles: string[]
  relatedSymbols: string[]
  confidence: number
}

export interface RepoWikiModelOutput {
  schemaVersion: 1
  action: 'save' | 'skip'
  reason?: string
  sections: RepoWikiModelSection[]
}

export interface RepoWikiJobStatus {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  startedAt: number
  completedAt?: number
  error?: string
  cancelable: false
}

export interface RepoWikiProviderHealthMetadata {
  summary: RepoWikiSummary
  generationJob?: RepoWikiJobStatus
  providerStatus: ContextProviderStatus
}
```

Modify `packages/core/src/context/types.ts`:

```ts
export type ContextSectionKind = 'agent_contract' | 'user_intent' | 'project_profile' | 'code_map' | 'relevant_code' | 'repo_wiki' | 'git_state' | 'memory' | 'conversation_state' | 'runtime_state' | 'ide_state' | 'diagnostics'
export type ContextProviderId = 'code' | 'repo_wiki' | 'project' | 'workflow' | 'git' | 'conversation' | 'memory' | 'runtime' | 'ide'
```

Also extend `ContextEngineConfig['providerToggles']` through the existing `ContextProviderId` type, then set the default in `packages/core/src/context/config.ts`:

```ts
providerToggles: {
  code: true,
  repo_wiki: true,
  project: true,
  workflow: true,
  git: true,
  conversation: true,
  memory: true,
  runtime: true,
  ide: true,
},
```

- [ ] **Step 3: Add zod schemas**

Create `packages/core/src/context/repo-wiki/schemas.ts`:

```ts
import { z } from 'zod'
import { ContextCitationSchema, ContextFreshnessSchema } from '../schemas.js'
import type { RepoWikiEntry, RepoWikiModelOutput } from './types.js'

export const RepoWikiEntryKindSchema = z.enum(['architecture', 'module_boundary', 'entrypoint', 'workflow', 'testing', 'convention', 'release', 'constraint'])
export const RepoWikiEntryStatusSchema = z.enum(['active', 'stale', 'archived', 'rejected'])

export const RepoWikiGeneratedBySchema = z.object({
  providerProtocol: z.string().min(1),
  modelId: z.string().min(1),
  modelProfileId: z.string().min(1).optional(),
})

export const RepoWikiEntrySchema = z.object({
  id: z.string().min(1),
  projectKey: z.string().min(1),
  kind: RepoWikiEntryKindSchema,
  title: z.string().min(1).max(160),
  content: z.string().min(1).max(4_000),
  citations: z.array(ContextCitationSchema).min(1),
  relatedFiles: z.array(z.string().min(1)),
  relatedSymbols: z.array(z.string().min(1)),
  confidence: z.number().finite().gt(0).lte(1),
  freshness: ContextFreshnessSchema,
  generatedBy: RepoWikiGeneratedBySchema,
  evidenceHash: z.string().min(1),
  status: RepoWikiEntryStatusSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  archivedAt: z.number().int().nonnegative().optional(),
  lifecycleReason: z.string().min(1).optional(),
}) satisfies z.ZodType<RepoWikiEntry>

export const RepoWikiModelOutputSchema = z.object({
  schemaVersion: z.literal(1),
  action: z.enum(['save', 'skip']),
  reason: z.string().optional(),
  sections: z.array(z.object({
    kind: RepoWikiEntryKindSchema,
    title: z.string().min(1).max(160),
    content: z.string().min(1).max(4_000),
    citationPacketIds: z.array(z.string().min(1)).min(1),
    relatedFiles: z.array(z.string().min(1)),
    relatedSymbols: z.array(z.string().min(1)),
    confidence: z.number().finite().gt(0).lte(1),
  })).max(24),
}).refine((output) => output.action === 'skip' || output.sections.length > 0, 'save output requires at least one section') satisfies z.ZodType<RepoWikiModelOutput>
```

Modify `packages/core/src/context/schemas.ts`:

```ts
export const ContextSectionKindSchema = z.enum(['agent_contract', 'user_intent', 'project_profile', 'code_map', 'relevant_code', 'repo_wiki', 'git_state', 'memory', 'conversation_state', 'runtime_state', 'ide_state', 'diagnostics'])
export const ContextProviderIdSchema = z.enum(['code', 'repo_wiki', 'project', 'workflow', 'git', 'conversation', 'memory', 'runtime', 'ide'])
```

- [ ] **Step 4: Add store schema migration**

Modify `packages/core/src/context/migrations/schema.ts`:

```ts
export const CONTEXT_STORE_SCHEMA_VERSION = 3
```

Add this table to `CREATE_CONTEXT_STORE_TABLES`:

```ts
`CREATE TABLE IF NOT EXISTS repo_wiki_entries(
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  wiki_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  citations_json TEXT NOT NULL,
  related_files_json TEXT NOT NULL,
  related_symbols_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  freshness TEXT NOT NULL,
  generated_by_json TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,
  lifecycle_reason TEXT
)`,
```

Add indexes:

```ts
`CREATE INDEX IF NOT EXISTS idx_repo_wiki_project_status ON repo_wiki_entries(project_key, status, freshness)`,
`CREATE INDEX IF NOT EXISTS idx_repo_wiki_project_kind ON repo_wiki_entries(project_key, kind)`,
`CREATE INDEX IF NOT EXISTS idx_repo_wiki_updated ON repo_wiki_entries(updated_at)`,
```

Add migration statements:

```ts
const MIGRATE_CONTEXT_STORE_V2_TO_V3 = [
  `CREATE TABLE IF NOT EXISTS repo_wiki_entries(
    id TEXT PRIMARY KEY,
    project_key TEXT NOT NULL,
    wiki_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    citations_json TEXT NOT NULL,
    related_files_json TEXT NOT NULL,
    related_symbols_json TEXT NOT NULL,
    confidence REAL NOT NULL,
    freshness TEXT NOT NULL,
    generated_by_json TEXT NOT NULL,
    evidence_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER,
    lifecycle_reason TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_repo_wiki_project_status ON repo_wiki_entries(project_key, status, freshness)`,
  `CREATE INDEX IF NOT EXISTS idx_repo_wiki_project_kind ON repo_wiki_entries(project_key, kind)`,
  `CREATE INDEX IF NOT EXISTS idx_repo_wiki_updated ON repo_wiki_entries(updated_at)`,
]
```

Update `getContextStoreMigrationStatements()`:

```ts
if (fromVersion === 0 && toVersion === 3) return [...CREATE_CONTEXT_STORE_TABLES, ...CREATE_CONTEXT_STORE_INDEXES, setSchemaVersionStatement(toVersion)]
if (fromVersion === 1 && toVersion === 3) return [...MIGRATE_CONTEXT_STORE_V1_TO_V2, ...MIGRATE_CONTEXT_STORE_V2_TO_V3, setSchemaVersionStatement(toVersion)]
if (fromVersion === 2 && toVersion === 3) return [...MIGRATE_CONTEXT_STORE_V2_TO_V3, setSchemaVersionStatement(toVersion)]
```

- [ ] **Step 5: Implement store methods**

Modify `packages/core/src/context/store.ts` imports:

```ts
import { RepoWikiEntrySchema } from './repo-wiki/schemas.js'
import type { RepoWikiEntry, RepoWikiEntryQuery, RepoWikiInvalidationResult, RepoWikiSummary } from './repo-wiki/types.js'
```

Extend `ContextStore`:

```ts
saveRepoWikiEntries(entries: RepoWikiEntry[]): Promise<ContextStoreResult<{ savedEntries: number }>>
listRepoWikiEntries(query?: RepoWikiEntryQuery): Promise<ContextStoreResult<RepoWikiEntry[]>>
getRepoWikiSummary(): Promise<ContextStoreResult<RepoWikiSummary>>
invalidateRepoWikiByFileHash(filePath: string, hash: string): Promise<ContextStoreResult<RepoWikiInvalidationResult>>
```

Add `'repo_wiki_entries'` to `PROJECT_SCOPED_TABLES` and add this index to `PROJECT_SCOPED_INDEXES`:

```ts
`CREATE INDEX IF NOT EXISTS idx_repo_wiki_project_status ON repo_wiki_entries(project_key, status, freshness)`,
```

Add the logical id backfill:

```ts
['repo_wiki_entries', 'wiki_id'],
```

Add `repo_wiki_entries` to unowned project backfill:

```ts
const unownedTables = ['memory_records', 'context_diagnostics', 'repo_wiki_entries'] as const
```

Implement the SQL methods in `SqlJsContextStore`:

```ts
async saveRepoWikiEntries(entries: RepoWikiEntry[]): Promise<ContextStoreResult<{ savedEntries: number }>> {
  const parsed: RepoWikiEntry[] = []
  for (const entry of entries) {
    const result = RepoWikiEntrySchema.safeParse(entry)
    if (!result.success) return failure({ savedEntries: 0 }, this.invalidDiagnostic('saveRepoWikiEntries', result.error.message))
    parsed.push({ ...result.data, projectKey: this.projectKey })
  }

  return this.write('saveRepoWikiEntries', { savedEntries: 0 }, () => {
    for (const entry of parsed) this.writeRepoWikiEntryRow(entry)
    return { savedEntries: parsed.length }
  })
}

async listRepoWikiEntries(query: RepoWikiEntryQuery = {}): Promise<ContextStoreResult<RepoWikiEntry[]>> {
  return this.read('listRepoWikiEntries', [], () => this.selectRepoWikiEntries(query))
}

async getRepoWikiSummary(): Promise<ContextStoreResult<RepoWikiSummary>> {
  return this.read('getRepoWikiSummary', { activeEntries: 0, staleEntries: 0 }, () => {
    const activeEntries = Number(this.selectRows("SELECT COUNT(*) AS count FROM repo_wiki_entries WHERE project_key = ? AND status = 'active' AND freshness != 'stale'", [this.projectKey])[0]?.count ?? 0)
    const staleEntries = Number(this.selectRows("SELECT COUNT(*) AS count FROM repo_wiki_entries WHERE project_key = ? AND (status = 'stale' OR freshness = 'stale')", [this.projectKey])[0]?.count ?? 0)
    const latest = this.selectRows("SELECT generated_by_json, updated_at, lifecycle_reason FROM repo_wiki_entries WHERE project_key = ? ORDER BY updated_at DESC LIMIT 1", [this.projectKey])[0]
    const generatedBy = latest?.generated_by_json ? JSON.parse(String(latest.generated_by_json)) as { modelId?: string } : undefined
    return {
      activeEntries,
      staleEntries,
      ...(latest?.updated_at ? { lastGeneratedAt: Number(latest.updated_at) } : {}),
      ...(generatedBy?.modelId ? { lastModelId: generatedBy.modelId } : {}),
      ...(latest?.lifecycle_reason ? { lastDiagnostic: String(latest.lifecycle_reason) } : {}),
    }
  })
}

async invalidateRepoWikiByFileHash(filePath: string, currentHash: string): Promise<ContextStoreResult<RepoWikiInvalidationResult>> {
  return this.write('invalidateRepoWikiByFileHash', { invalidatedEntries: 0 }, () => {
    const normalizedFilePath = normalizeFileCitationRef(filePath, this.projectKey)
    const entries = this.selectRepoWikiEntries({ includeStale: true, includeArchived: false })
    const invalidated = entries.filter((entry) =>
      entry.status === 'active' &&
      entry.citations.some((citation) =>
        citation.type === 'file' &&
        normalizeFileCitationRef(citation.ref, this.projectKey) === normalizedFilePath &&
        citation.hash !== currentHash,
      ),
    )
    for (const entry of invalidated) {
      this.db.run(
        `UPDATE repo_wiki_entries
         SET freshness = ?, status = ?, updated_at = ?, lifecycle_reason = ?
         WHERE project_key = ? AND wiki_id = ?`,
        ['stale', 'stale', this.now(), `cited file changed: ${normalizedFilePath}`, this.projectKey, entry.id],
      )
    }
    return { invalidatedEntries: invalidated.length }
  })
}
```

Add helpers near the fact row helpers:

```ts
private writeRepoWikiEntryRow(entry: RepoWikiEntry): void {
  this.db.run(
    `INSERT OR REPLACE INTO repo_wiki_entries(id, project_key, wiki_id, kind, title, content, citations_json, related_files_json, related_symbols_json, confidence, freshness, generated_by_json, evidence_hash, status, created_at, updated_at, archived_at, lifecycle_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      scopedId(this.projectKey, entry.id),
      this.projectKey,
      entry.id,
      entry.kind,
      sanitizeStoreText(entry.title),
      sanitizeStoreText(entry.content),
      JSON.stringify(entry.citations),
      JSON.stringify(entry.relatedFiles),
      JSON.stringify(entry.relatedSymbols),
      entry.confidence,
      entry.freshness,
      JSON.stringify(entry.generatedBy),
      entry.evidenceHash,
      entry.status,
      entry.createdAt,
      entry.updatedAt,
      entry.archivedAt ?? null,
      entry.lifecycleReason ? sanitizeStoreText(entry.lifecycleReason) : null,
    ],
  )
}

private selectRepoWikiEntries(query: RepoWikiEntryQuery): RepoWikiEntry[] {
  const conditions = ['project_key = ?']
  const params: SqlValue[] = [this.projectKey]
  if (!query.includeStale) conditions.push("freshness != 'stale'", "status != 'stale'")
  if (!query.includeArchived) conditions.push("status != 'archived'")
  if (query.kinds?.length) {
    conditions.push(`kind IN (${query.kinds.map(() => '?').join(', ')})`)
    params.push(...query.kinds)
  }
  const rows = this.selectRows(
    `SELECT * FROM repo_wiki_entries WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC${query.limit ? ' LIMIT ?' : ''}`,
    query.limit ? [...params, query.limit] : params,
  )
  return rows.map(parseRepoWikiEntryRow)
    .filter((entry) => !query.relatedFile || entry.relatedFiles.includes(query.relatedFile) || entry.citations.some((citation) => citation.ref === query.relatedFile))
    .filter((entry) => !query.relatedSymbol || entry.relatedSymbols.includes(query.relatedSymbol))
}
```

Add parser:

```ts
function parseRepoWikiEntryRow(row: Record<string, unknown>): RepoWikiEntry {
  return RepoWikiEntrySchema.parse({
    id: String(row.wiki_id ?? row.id),
    projectKey: String(row.project_key),
    kind: String(row.kind),
    title: String(row.title),
    content: String(row.content),
    citations: JSON.parse(String(row.citations_json)),
    relatedFiles: JSON.parse(String(row.related_files_json)),
    relatedSymbols: JSON.parse(String(row.related_symbols_json)),
    confidence: Number(row.confidence),
    freshness: String(row.freshness),
    generatedBy: JSON.parse(String(row.generated_by_json)),
    evidenceHash: String(row.evidence_hash),
    status: String(row.status),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    archivedAt: row.archived_at == null ? undefined : Number(row.archived_at),
    lifecycleReason: row.lifecycle_reason == null ? undefined : String(row.lifecycle_reason),
  })
}
```

Add unavailable store methods:

```ts
async saveRepoWikiEntries(): Promise<ContextStoreResult<{ savedEntries: number }>> { return this.unavailable({ savedEntries: 0 }) }
async listRepoWikiEntries(): Promise<ContextStoreResult<RepoWikiEntry[]>> { return this.unavailable([]) }
async getRepoWikiSummary(): Promise<ContextStoreResult<RepoWikiSummary>> { return this.unavailable({ activeEntries: 0, staleEntries: 0 }) }
async invalidateRepoWikiByFileHash(): Promise<ContextStoreResult<RepoWikiInvalidationResult>> { return this.unavailable({ invalidatedEntries: 0 }) }
```

- [ ] **Step 6: Export public types**

Create `packages/core/src/context/repo-wiki/index.ts`:

```ts
export type {
  RepoWikiEntry,
  RepoWikiEntryKind,
  RepoWikiEntryQuery,
  RepoWikiEvidencePacket,
  RepoWikiGeneratedBy,
  RepoWikiInvalidationResult,
  RepoWikiJobStatus,
  RepoWikiModelOutput,
  RepoWikiModelSection,
  RepoWikiProviderHealthMetadata,
  RepoWikiSummary,
} from './types.js'
export { RepoWikiEntrySchema, RepoWikiModelOutputSchema } from './schemas.js'
```

Modify `packages/core/src/index.ts`:

```ts
export type {
  RepoWikiEntry,
  RepoWikiEntryKind,
  RepoWikiEntryQuery,
  RepoWikiSummary,
} from './context/repo-wiki/index.js'
```

- [ ] **Step 7: Run focused tests and commit**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/store.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core build
git diff --check
```

Expected: PASS.

Commit:

```bash
git add packages/core/src/context/repo-wiki/types.ts packages/core/src/context/repo-wiki/schemas.ts packages/core/src/context/repo-wiki/index.ts packages/core/src/context/types.ts packages/core/src/context/schemas.ts packages/core/src/context/config.ts packages/core/src/context/migrations/schema.ts packages/core/src/context/store.ts packages/core/src/context/store.test.ts packages/core/src/index.ts
git commit -m "feat: add repo wiki context storage"
```

---

## Task 2: Model-Generated Repo Wiki Generator

**Goal:** Generate Wiki entries with the active model from a bounded evidence packet, then validate every cited packet and file hash before storage.

**Files:**

- Create: `packages/core/src/context/repo-wiki/evidence.ts`
- Create: `packages/core/src/context/repo-wiki/model-client.ts`
- Create: `packages/core/src/context/repo-wiki/generator.ts`
- Create: `packages/core/src/context/repo-wiki/repo-wiki.test.ts`
- Modify: `packages/core/src/context/repo-wiki/index.ts`

- [ ] **Step 1: Add failing generator tests**

Create `packages/core/src/context/repo-wiki/repo-wiki.test.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { IndexStore } from '../../context-engine/graph/store.js'
import type { FileIndex } from '../../context-engine/types.js'
import { buildRepoWikiEvidencePacket, generateRepoWikiEntries, retrieveRepoWikiEntries } from './index.js'
import type { RepoWikiModelClient } from './model-client.js'

function tmpRepo(): string {
  return path.join(tmpdir(), `jdc-repo-wiki-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

function indexedFile(filePath: string, hash: string, symbols: FileIndex['symbols'] = []): FileIndex {
  return { filePath, language: 'typescript', hash, symbols, references: [], imports: [] }
}

describe('repo wiki generation', () => {
  it('builds evidence packets from repo map, docs, and package scripts', () => {
    const cwd = tmpRepo()
    mkdirSync(path.join(cwd, 'packages/core/src'), { recursive: true })
    writeFileSync(path.join(cwd, 'README.md'), '# JDC\n\nRun pnpm test.\n')
    writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', build: 'tsc -b' } }))
    writeFileSync(path.join(cwd, 'packages/core/src/session.ts'), 'export class Session {}\n')

    const store = new IndexStore()
    store.upsertFile(indexedFile('packages/core/src/session.ts', 'hash_session', [{
      id: 'sym_session',
      name: 'Session',
      kind: 'class',
      filePath: 'packages/core/src/session.ts',
      line: 1,
      signature: 'export class Session',
    }]))

    const packet = buildRepoWikiEvidencePacket({ cwd, indexStore: store, now: () => 1 })

    expect(packet.packets.map((item) => item.ref)).toContain('packages/core/src/session.ts')
    expect(packet.packets.map((item) => item.ref)).toContain('README.md')
    expect(packet.packets.map((item) => item.ref)).toContain('package.json')
    expect(packet.evidenceHash).toMatch(/[a-f0-9]{64}/)
  })

  it('accepts model sections only when every citation resolves to a packet hash', async () => {
    const cwd = tmpRepo()
    mkdirSync(path.join(cwd, 'src'), { recursive: true })
    writeFileSync(path.join(cwd, 'src/main.ts'), 'export function main() {}\n')
    const store = new IndexStore()
    store.upsertFile(indexedFile('src/main.ts', 'hash_main', [{
      id: 'sym_main',
      name: 'main',
      kind: 'function',
      filePath: 'src/main.ts',
      line: 1,
      signature: 'export function main()',
    }]))
    const packet = buildRepoWikiEvidencePacket({ cwd, indexStore: store, now: () => 1 })
    const modelClient: RepoWikiModelClient = {
      completeRepoWiki: vi.fn(async () => JSON.stringify({
        schemaVersion: 1,
        action: 'save',
        sections: [{
          kind: 'entrypoint',
          title: 'Runtime entry point',
          content: 'The main runtime starts from the exported main function.',
          citationPacketIds: [packet.packets[0]!.id],
          relatedFiles: ['src/main.ts'],
          relatedSymbols: ['main'],
          confidence: 0.9,
        }],
      })),
    }

    const generated = await generateRepoWikiEntries({
      cwd,
      projectKey: cwd,
      evidence: packet,
      modelClient,
      model: { providerProtocol: 'anthropic', modelId: 'claude-sonnet-4', modelProfileId: 'standard' },
      now: () => 2,
    })

    expect(generated.entries).toEqual([
      expect.objectContaining({
        kind: 'entrypoint',
        title: 'Runtime entry point',
        citations: [expect.objectContaining({ ref: 'src/main.ts', hash: 'hash_main' })],
      }),
    ])
    expect(generated.diagnostics).toEqual([])
  })

  it('rejects model sections that cite unknown evidence packets', async () => {
    const cwd = tmpRepo()
    mkdirSync(path.join(cwd, 'src'), { recursive: true })
    writeFileSync(path.join(cwd, 'src/main.ts'), 'export function main() {}\n')
    const store = new IndexStore()
    store.upsertFile(indexedFile('src/main.ts', 'hash_main'))
    const packet = buildRepoWikiEvidencePacket({ cwd, indexStore: store, now: () => 1 })
    const modelClient: RepoWikiModelClient = {
      completeRepoWiki: vi.fn(async () => JSON.stringify({
        schemaVersion: 1,
        action: 'save',
        sections: [{
          kind: 'architecture',
          title: 'Bad section',
          content: 'This section cites an unknown packet.',
          citationPacketIds: ['missing_packet'],
          relatedFiles: ['src/main.ts'],
          relatedSymbols: [],
          confidence: 0.9,
        }],
      })),
    }

    const generated = await generateRepoWikiEntries({
      cwd,
      projectKey: cwd,
      evidence: packet,
      modelClient,
      model: { providerProtocol: 'anthropic', modelId: 'claude-sonnet-4' },
      now: () => 2,
    })

    expect(generated.entries).toEqual([])
    expect(generated.diagnostics[0]?.message).toContain('unknown citation packet')
  })
})

describe('repo wiki retrieval', () => {
  it('scores entries by query, related files, related symbols, and evidence requirements', () => {
    const entries = retrieveRepoWikiEntries({
      query: '谁负责 Session 上下文注入',
      evidenceRequirements: [{
        id: 'req_code',
        kind: 'relevant_code',
        reason: 'Need target code',
        query: 'Session',
        priority: 'must',
        relatedFiles: ['packages/core/src/session.ts'],
        relatedSymbols: ['Session'],
        docRefs: [],
        languageHints: ['zh'],
      }],
      entries: [{
        id: 'wiki_session',
        projectKey: '/repo',
        kind: 'architecture',
        title: 'Session context injection',
        content: 'Session injects context before model calls.',
        citations: [{ id: 'cit', type: 'file', ref: 'packages/core/src/session.ts', hash: 'hash_session' }],
        relatedFiles: ['packages/core/src/session.ts'],
        relatedSymbols: ['Session'],
        confidence: 0.9,
        freshness: 'cached',
        generatedBy: { providerProtocol: 'anthropic', modelId: 'claude-sonnet-4' },
        evidenceHash: 'hash',
        status: 'active',
        createdAt: 1,
        updatedAt: 1,
      }],
    })

    expect(entries[0]).toMatchObject({ entry: expect.objectContaining({ id: 'wiki_session' }), reasons: expect.arrayContaining(['requirement_file_match', 'requirement_symbol_match']) })
  })
})
```

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/repo-wiki/repo-wiki.test.ts --no-file-parallelism
```

Expected: FAIL because the Repo Wiki generator files do not exist.

- [ ] **Step 2: Build evidence packets**

Create `packages/core/src/context/repo-wiki/evidence.ts`:

```ts
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { hashContent as hashCurrentFileContent } from '../providers/shared.js'
import { buildRepoMap, renderRepoMap } from '../../context-engine/repo-map.js'
import { hashContent as hashIndexedFileContent } from '../../context-engine/parser/parser.js'
import type { IndexStore } from '../../context-engine/graph/store.js'
import type { ContextDiagnostic } from '../types.js'
import type { RepoWikiEvidencePacket } from './types.js'

export interface RepoWikiEvidenceInput {
  cwd: string
  indexStore: Pick<IndexStore, 'allFiles'>
  now?: () => number
  maxDocs?: number
  maxPacketChars?: number
}

export interface RepoWikiEvidenceBundle {
  packets: RepoWikiEvidencePacket[]
  evidenceHash: string
  createdAt: number
  diagnostics: ContextDiagnostic[]
}

// No hidden default caps: docs/packet size are only bounded when the caller opts in via maxDocs/maxPacketChars.
const DOC_CANDIDATES = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'CONTRIBUTING.md', 'package.json', 'pnpm-workspace.yaml', 'turbo.json']

export function buildRepoWikiEvidencePacket(input: RepoWikiEvidenceInput): RepoWikiEvidenceBundle {
  const now = input.now ?? Date.now
  const createdAt = now()
  const packets: RepoWikiEvidencePacket[] = []
  const diagnostics: ContextDiagnostic[] = []
  const repoMap = buildRepoMap(input.indexStore)
  const repoMapContent = renderRepoMap(repoMap)
  if (repoMap.files.length > 0) {
    packets.push({
      id: packetId('repo_map', 'code-index'),
      ref: 'code-index',
      title: 'Code index repository map',
      content: trimPacket(repoMapContent, input.maxPacketChars),
      hash: hashContent(repoMapContent),
      relatedSymbols: repoMap.symbols.map((symbol) => symbol.name),
    })
  }

  for (const file of repoMap.files) {
    const absolute = path.join(input.cwd, file.path)
    let currentContent: string
    try {
      currentContent = readFileSync(absolute, 'utf-8')
    } catch (error) {
      diagnostics.push(repoWikiEvidenceDiagnostic('warning', `Repo Wiki evidence skipped unreadable indexed file ${file.path}`, createdAt))
      continue
    }
    const currentIndexHash = hashIndexedFileContent(currentContent)
    const currentCitationHash = hashCurrentFileContent(currentContent)
    const storedIndexHash = input.indexStore.allFiles().find((item) => item.filePath === file.path)?.hash
    if (storedIndexHash && storedIndexHash !== currentIndexHash) {
      diagnostics.push(repoWikiEvidenceDiagnostic('warning', `Repo Wiki evidence skipped stale index packet for ${file.path}: indexed hash does not match current file hash`, createdAt))
      continue
    }
    packets.push({
      id: packetId('file', file.path),
      ref: file.path,
      title: `${file.role}: ${file.path}`,
      content: trimPacket([
        `${file.path} (${file.role}, ${file.language})`,
        ...file.topSymbols.map((symbol) => `${symbol.kind} ${symbol.name}:${symbol.line}${symbol.signature ? ` ${symbol.signature}` : ''}`),
      ].join('\n'), input.maxPacketChars),
      hash: currentCitationHash,
      relatedSymbols: file.topSymbols.map((symbol) => symbol.name),
    })
  }

  const docCandidates = typeof input.maxDocs === 'number' ? DOC_CANDIDATES.slice(0, Math.max(0, input.maxDocs)) : DOC_CANDIDATES
  for (const ref of docCandidates) {
    const absolute = path.join(input.cwd, ref)
    if (!existsSync(absolute)) continue
    const content = readFileSync(absolute, 'utf-8')
    packets.push({
      id: packetId('doc', ref),
      ref,
      title: `Repository document: ${ref}`,
      content: trimPacket(content, input.maxPacketChars),
      hash: hashContent(content),
      relatedSymbols: [],
    })
  }

  const evidenceHash = hashContent(JSON.stringify(packets.map(({ id, ref, hash, content }) => ({ id, ref, hash, content }))))
  return { packets, evidenceHash, createdAt, diagnostics }
}

function trimPacket(content: string, maxChars?: number): string {
  return typeof maxChars === 'number' && content.length > maxChars ? content.slice(0, maxChars) : content
}

function packetId(kind: string, ref: string): string {
  return `wiki_packet_${createHash('sha1').update(`${kind}:${ref}`).digest('hex').slice(0, 16)}`
}

function repoWikiEvidenceDiagnostic(level: ContextDiagnostic['level'], message: string, createdAt: number): ContextDiagnostic {
  return {
    id: `diag_repo_wiki_evidence_${createHash('sha1').update(`${message}:${createdAt}`).digest('hex').slice(0, 16)}`,
    level,
    source: 'RepoWikiEvidence',
    message,
    createdAt,
    visibleInPrimaryUi: true,
  }
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
```

The code index file hash uses the parser's sha1 hashing, while citation hashes use the current file's sha256 content hash (the same hash the session uses for file-change invalidation). Indexed-file packets are skipped with a diagnostic when the current file is unreadable or its index hash no longer matches the current file, so a stale index snapshot cannot produce a Repo Wiki citation that looks fresh.

- [ ] **Step 3: Add model client**

Create `packages/core/src/context/repo-wiki/model-client.ts`:

```ts
import { z } from 'zod'
import type { ContentBlock, Message, ModelConfig, ToolDefinition } from '../../types.js'
import type { RepoWikiEvidenceBundle } from './evidence.js'

export interface RepoWikiModelRequest {
  cwd: string
  evidence: RepoWikiEvidenceBundle
  modelConfig: ModelConfig
  modelId: string
  cacheUser: string
  signal?: AbortSignal
}

export interface RepoWikiModelClient {
  completeRepoWiki(request: RepoWikiModelRequest): Promise<string>
}

const TextBlockSchema = z.object({ type: z.literal('text'), text: z.string() })

export function createProviderRepoWikiModelClient(provider: {
  chat(messages: Message[], tools: ToolDefinition[], config: ModelConfig, signal?: AbortSignal): Promise<{ content: ContentBlock[] }>
}): RepoWikiModelClient {
  return {
    async completeRepoWiki(request) {
      const response = await provider.chat(
        [{
          id: `repo_wiki_${request.evidence.evidenceHash.slice(0, 16)}`,
          role: 'user',
          content: [{ type: 'text', text: buildRepoWikiPrompt(request) }],
          timestamp: request.evidence.createdAt,
        }],
        [],
        {
          ...request.modelConfig,
          model: request.modelId,
          maxTokens: Math.min(request.modelConfig.maxTokens, 8_000),
          systemPrompt: REPO_WIKI_SYSTEM_PROMPT,
          cacheKey: 'repo-wiki-generator:v1',
          cacheUser: request.cacheUser,
        },
        request.signal,
      )
      return response.content
        .map((block) => TextBlockSchema.safeParse(block))
        .filter((parsed): parsed is z.SafeParseSuccess<z.infer<typeof TextBlockSchema>> => parsed.success)
        .map((parsed) => parsed.data.text)
        .join('\n')
    },
  }
}

export function buildRepoWikiPrompt(request: RepoWikiModelRequest): string {
  return JSON.stringify({
    task: 'Generate a JDC Repo Wiki as one strict JSON object.',
    schema: {
      schemaVersion: 1,
      action: 'save or skip',
      reason: 'string only when skipping',
      sections: [{
        kind: 'architecture | module_boundary | entrypoint | workflow | testing | convention | release | constraint',
        title: 'short title',
        content: 'concise, factual summary backed by cited packets',
        citationPacketIds: ['packet id strings from evidence.packets'],
        relatedFiles: ['file paths from cited packets'],
        relatedSymbols: ['symbols from evidence packets'],
        confidence: 'number > 0 and <= 1',
      }],
    },
    rules: [
      'Return JSON only.',
      'Every saved section must cite at least one file or repository-document evidence packet id.',
      'The code-index packet is orientation context only; do not include it in citationPacketIds.',
      'Do not cite packet ids that are not in evidence.packets.',
      'Do not include hidden reasoning, chain of thought, secrets, markdown fences, or extra keys.',
      'Prefer sections that help future coding, review, debugging, testing, and planning tasks.',
      'If evidence is too small or contradictory, return {"schemaVersion":1,"action":"skip","reason":"insufficient_evidence","sections":[]}.',
    ],
    evidence: request.evidence,
  })
}

const REPO_WIKI_SYSTEM_PROMPT = 'You generate citation-backed repository Wiki JSON for JDC Context Engine. Use only provided evidence packet ids. Return JSON only. Do not include raw hidden reasoning.'
```

- [ ] **Step 4: Add generation and validation**

Create `packages/core/src/context/repo-wiki/generator.ts`:

```ts
import { createHash } from 'node:crypto'
import type { ContextCitation, ContextDiagnostic } from '../types.js'
import { RepoWikiModelOutputSchema } from './schemas.js'
import type { RepoWikiEntry, RepoWikiGeneratedBy, RepoWikiModelOutput } from './types.js'
import type { RepoWikiEvidenceBundle, RepoWikiEvidencePacket } from './evidence.js'
import type { RepoWikiModelClient, RepoWikiModelRequest } from './model-client.js'

export interface GenerateRepoWikiInput {
  cwd: string
  projectKey: string
  evidence: RepoWikiEvidenceBundle
  modelClient: RepoWikiModelClient
  model: RepoWikiGeneratedBy
  modelRequest?: Omit<RepoWikiModelRequest, 'cwd' | 'evidence' | 'modelId'>
  now?: () => number
}

export interface GenerateRepoWikiResult {
  entries: RepoWikiEntry[]
  diagnostics: ContextDiagnostic[]
}

export async function generateRepoWikiEntries(input: GenerateRepoWikiInput): Promise<GenerateRepoWikiResult> {
  const now = input.now ?? Date.now
  const diagnostics: ContextDiagnostic[] = []
  try {
    const raw = await input.modelClient.completeRepoWiki({
      cwd: input.cwd,
      evidence: input.evidence,
      modelId: input.model.modelId,
      modelConfig: input.modelRequest?.modelConfig ?? { model: input.model.modelId, maxTokens: 8_000 },
      cacheUser: input.modelRequest?.cacheUser ?? input.projectKey,
      signal: input.modelRequest?.signal,
    })
    const output = parseRepoWikiModelOutput(raw)
    if (output.action === 'skip') {
      diagnostics.push(repoWikiDiagnostic(`Repo Wiki generation skipped: ${output.reason ?? 'model skipped'}`, 'info', now()))
      return { entries: [], diagnostics }
    }
    const validation = validateRepoWikiModelOutput(output, input.evidence, input.projectKey, input.model, now())
    return validation.entries.length
      ? validation
      : { entries: [], diagnostics: validation.diagnostics.length ? validation.diagnostics : [repoWikiDiagnostic('Repo Wiki model output produced no valid sections.', 'warning', now())] }
  } catch (error) {
    return {
      entries: [],
      diagnostics: [repoWikiDiagnostic(`Repo Wiki generation failed without blocking foreground chat: ${error instanceof Error ? error.message : String(error)}`, 'error', now())],
    }
  }
}

export function parseRepoWikiModelOutput(raw: string): RepoWikiModelOutput {
  const jsonText = extractJsonObject(raw)
  return RepoWikiModelOutputSchema.parse(JSON.parse(jsonText))
}

export function validateRepoWikiModelOutput(
  output: RepoWikiModelOutput,
  evidence: RepoWikiEvidenceBundle,
  projectKey: string,
  model: RepoWikiGeneratedBy,
  createdAt: number,
): GenerateRepoWikiResult {
  const packetsById = new Map(evidence.packets.map((packet) => [packet.id, packet]))
  const diagnostics: ContextDiagnostic[] = []
  const entries: RepoWikiEntry[] = []

  for (const section of output.sections) {
    if (containsHiddenReasoning(section.content)) {
      diagnostics.push(repoWikiDiagnostic(`Rejected Repo Wiki section "${section.title}" because content contains hidden reasoning markers.`, 'warning', createdAt))
      continue
    }
    const citedPackets = section.citationPacketIds.map((id) => packetsById.get(id))
    const missing = section.citationPacketIds.filter((id) => !packetsById.has(id))
    if (missing.length) {
      diagnostics.push(repoWikiDiagnostic(`Rejected Repo Wiki section "${section.title}" because it cited unknown citation packet ${missing.join(', ')}.`, 'warning', createdAt))
      continue
    }
    const citations = citedPackets.filter((packet): packet is RepoWikiEvidencePacket => Boolean(packet)).map((packet, index) => citationFromPacket(packet, section.title, index, createdAt))
    if (citedPackets.some((packet) => packet?.ref === 'code-index')) {
      diagnostics.push(repoWikiDiagnostic(`Rejected Repo Wiki section "${section.title}" because code-index is orientation context and cannot be used as a final citation.`, 'warning', createdAt))
      continue
    }
    if (citations.length === 0 || citations.some((citation) => !citation.hash)) {
      diagnostics.push(repoWikiDiagnostic(`Rejected Repo Wiki section "${section.title}" because every section must cite hashed file evidence.`, 'warning', createdAt))
      continue
    }
    entries.push({
      id: stableWikiId(section.kind, section.title, section.citationPacketIds),
      projectKey,
      kind: section.kind,
      title: section.title,
      content: section.content,
      citations,
      relatedFiles: unique([...section.relatedFiles, ...citations.map((citation) => citation.ref)]),
      relatedSymbols: unique(section.relatedSymbols),
      confidence: section.confidence,
      freshness: 'cached',
      generatedBy: model,
      evidenceHash: evidence.evidenceHash,
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    })
  }

  return { entries, diagnostics }
}

function citationFromPacket(packet: RepoWikiEvidencePacket, title: string, index: number, timestamp: number): ContextCitation {
  return {
    id: `repo_wiki_cit_${createHash('sha1').update(`${title}:${packet.id}:${index}`).digest('hex').slice(0, 16)}`,
    type: 'file',
    ref: packet.ref,
    line: packet.line,
    timestamp,
    hash: packet.hash,
  }
}

function extractJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1] ?? raw
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('Repo Wiki model output did not contain a JSON object')
  return candidate.slice(start, end + 1)
}

function containsHiddenReasoning(content: string): boolean {
  return /chain[- ]of[- ]thought|hidden reasoning|scratchpad|<thinking>|<\/thinking>/i.test(content)
}

function stableWikiId(kind: string, title: string, packetIds: string[]): string {
  return `repo_wiki_${createHash('sha1').update([kind, title, ...packetIds].join('\u0000')).digest('hex').slice(0, 16)}`
}

function repoWikiDiagnostic(message: string, level: ContextDiagnostic['level'], createdAt: number): ContextDiagnostic {
  return { id: `diag_repo_wiki_${createHash('sha1').update(`${message}:${createdAt}`).digest('hex').slice(0, 16)}`, level, source: 'RepoWikiGenerator', message, createdAt, visibleInPrimaryUi: level !== 'info' }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
```

- [ ] **Step 5: Add retrieval scoring**

Create `packages/core/src/context/repo-wiki/retrieval.ts`:

```ts
import type { ContextEvidenceRequirement } from '../types.js'
import type { RepoWikiEntry } from './types.js'

export interface RetrievedRepoWikiEntry {
  entry: RepoWikiEntry
  score: number
  reasons: string[]
}

export interface RetrieveRepoWikiEntriesInput {
  query: string
  evidenceRequirements?: ContextEvidenceRequirement[]
  entries: RepoWikiEntry[]
  limit?: number
}

export function retrieveRepoWikiEntries(input: RetrieveRepoWikiEntriesInput): RetrievedRepoWikiEntry[] {
  const queryTokens = tokens(input.query)
  const requirements = input.evidenceRequirements ?? []
  return input.entries
    .filter((entry) => entry.status === 'active' && entry.freshness !== 'stale')
    .map((entry) => scoreEntry(entry, queryTokens, requirements))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt || a.entry.id.localeCompare(b.entry.id))
    .slice(0, input.limit ?? 6)
}

function scoreEntry(entry: RepoWikiEntry, queryTokens: string[], requirements: ContextEvidenceRequirement[]): RetrievedRepoWikiEntry {
  const reasons: string[] = []
  let score = entry.confidence * 10
  const haystack = tokens([entry.kind, entry.title, entry.content, ...entry.relatedFiles, ...entry.relatedSymbols, ...entry.citations.map((citation) => citation.ref)].join(' '))
  const haystackSet = new Set(haystack)
  const matched = queryTokens.filter((token) => haystackSet.has(token))
  if (matched.length) {
    score += matched.length * 12
    reasons.push('query_match')
  }
  const files = new Set(entry.relatedFiles.map(normalize))
  const symbols = new Set(entry.relatedSymbols.map(normalize))
  const refs = new Set(entry.citations.map((citation) => normalize(citation.ref)))
  for (const requirement of requirements) {
    if (requirement.relatedFiles.some((file) => files.has(normalize(file)) || refs.has(normalize(file)))) {
      score += requirement.priority === 'must' ? 80 : 35
      reasons.push('requirement_file_match')
    }
    if (requirement.relatedSymbols.some((symbol) => symbols.has(normalize(symbol)))) {
      score += requirement.priority === 'must' ? 70 : 30
      reasons.push('requirement_symbol_match')
    }
    if (requirement.docRefs.some((doc) => refs.has(normalize(doc)))) {
      score += requirement.priority === 'must' ? 50 : 25
      reasons.push('requirement_doc_match')
    }
  }
  if (entry.kind === 'architecture' || entry.kind === 'module_boundary') {
    score += 6
    reasons.push('high_value_kind')
  }
  return { entry, score, reasons: [...new Set(reasons)] }
}

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^\p{L}\p{N}_./:-]+/u).map((token) => token.trim()).filter(Boolean)
}

function normalize(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase()
}
```

Update `packages/core/src/context/repo-wiki/index.ts`:

```ts
export { buildRepoWikiEvidencePacket } from './evidence.js'
export type { RepoWikiEvidenceBundle } from './evidence.js'
export { generateRepoWikiEntries, parseRepoWikiModelOutput, validateRepoWikiModelOutput } from './generator.js'
export type { GenerateRepoWikiInput, GenerateRepoWikiResult } from './generator.js'
export { createProviderRepoWikiModelClient, buildRepoWikiPrompt } from './model-client.js'
export type { RepoWikiModelClient, RepoWikiModelRequest } from './model-client.js'
export { retrieveRepoWikiEntries } from './retrieval.js'
export type { RetrievedRepoWikiEntry, RetrieveRepoWikiEntriesInput } from './retrieval.js'
```

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/repo-wiki/repo-wiki.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core build
git diff --check
```

Expected: PASS.

Commit:

```bash
git add packages/core/src/context/repo-wiki packages/core/src/index.ts
git commit -m "feat: generate cited repo wiki entries"
```

---

## Task 3: Repo Wiki Provider and Background Refresh

**Goal:** Add a foreground provider that retrieves Wiki entries and queues background model generation when the Wiki is missing or stale.

**Files:**

- Create: `packages/core/src/context/repo-wiki/provider.ts`
- Create: `packages/core/src/context/providers/repo-wiki-provider.test.ts`
- Modify: `packages/core/src/context/providers/index.ts`
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/session-context.test.ts`

- [ ] **Step 1: Add failing provider tests**

Create `packages/core/src/context/providers/repo-wiki-provider.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { collectRepoWikiContext } from '../repo-wiki/provider.js'
import type { ContextRequest } from '../types.js'
import type { ContextStore } from '../store.js'

function request(overrides: Partial<ContextRequest> = {}): ContextRequest {
  return {
    sessionId: 'session_1',
    cwd: '/repo',
    userMessage: 'Session 怎么注入上下文',
    recentMessages: [],
    mode: 'code_edit',
    model: 'claude-sonnet-4',
    runtime: {},
    createdAt: 1_700_000_000_000,
    evidenceRequirements: [{
      id: 'req_1',
      kind: 'relevant_code',
      reason: 'Need code evidence',
      query: 'Session context',
      priority: 'must',
      relatedFiles: ['packages/core/src/session.ts'],
      relatedSymbols: ['Session'],
      docRefs: [],
      languageHints: ['zh'],
    }],
    ...overrides,
  }
}

function storeWithEntries(entries: any[]): Pick<ContextStore, 'listRepoWikiEntries' | 'getRepoWikiSummary' | 'saveDiagnostic' | 'saveRepoWikiEntries'> {
  return {
    listRepoWikiEntries: vi.fn(async () => ({ ok: true, value: entries, diagnostics: [] })),
    getRepoWikiSummary: vi.fn(async () => ({ ok: true, value: { activeEntries: entries.length, staleEntries: 0, lastGeneratedAt: 1, lastModelId: 'claude-sonnet-4' }, diagnostics: [] })),
    saveDiagnostic: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
    saveRepoWikiEntries: vi.fn(async () => ({ ok: true, value: { savedEntries: 0 }, diagnostics: [] })),
  } as any
}

describe('collectRepoWikiContext', () => {
  it('renders matching wiki entries as a repo_wiki context section', async () => {
    const result = await collectRepoWikiContext(request(), {
      store: storeWithEntries([{
        id: 'wiki_session',
        projectKey: '/repo',
        kind: 'architecture',
        title: 'Session context injection',
        content: 'Session injects context before model calls.',
        citations: [{ id: 'cit', type: 'file', ref: 'packages/core/src/session.ts', hash: 'hash_session' }],
        relatedFiles: ['packages/core/src/session.ts'],
        relatedSymbols: ['Session'],
        confidence: 0.91,
        freshness: 'cached',
        generatedBy: { providerProtocol: 'anthropic', modelId: 'claude-sonnet-4' },
        evidenceHash: 'hash',
        status: 'active',
        createdAt: 1,
        updatedAt: 1,
      }]),
    })

    expect(result.sections).toEqual([
      expect.objectContaining({
        kind: 'repo_wiki',
        title: 'Repo Wiki',
        sourceProvider: 'RepoWikiProvider',
        citations: [expect.objectContaining({ ref: 'packages/core/src/session.ts' })],
      }),
    ])
    expect(result.health).toMatchObject({ id: 'repo_wiki', status: 'cached' })
  })

  it('queues generation when no active entries exist and foreground returns quickly', async () => {
    const scheduler = { enqueueBackground: vi.fn(() => ({ accepted: true, promise: Promise.resolve() })), recorder: { record: vi.fn() } }
    const result = await collectRepoWikiContext(request(), {
      store: storeWithEntries([]),
      scheduler: scheduler as any,
      getContextEngine: () => ({ isIndexed: () => true, getStore: () => ({ allFiles: () => [] }) }) as any,
      modelClient: { completeRepoWiki: vi.fn(async () => '{"schemaVersion":1,"action":"skip","reason":"insufficient_evidence","sections":[]}') },
      modelConfig: { model: 'claude-sonnet-4', maxTokens: 8_000 },
      providerProtocol: 'anthropic',
    })

    expect(result.sections).toEqual([])
    expect(result.health).toMatchObject({ id: 'repo_wiki', status: 'indexing' })
    expect(scheduler.enqueueBackground).toHaveBeenCalledWith('/repo', 'repo_wiki_generate', expect.any(Function), { minIntervalMs: 300000 })
  })
})
```

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/providers/repo-wiki-provider.test.ts --no-file-parallelism
```

Expected: FAIL because provider file does not exist.

- [ ] **Step 2: Implement provider**

Create `packages/core/src/context/repo-wiki/provider.ts`:

```ts
import { getContextEngine } from '../../context-engine/index.js'
import type { ContextEngine } from '../../context-engine/engine.js'
import type { ModelConfig } from '../../types.js'
import { createContextScheduler, type ContextScheduler } from '../scheduler.js'
import type { ContextStore } from '../store.js'
import type { ContextRequest } from '../types.js'
import { disabledProviderResult, failedProviderResult, nowFromRequest, providerHealth, section, stableId } from '../providers/shared.js'
import { buildRepoWikiEvidencePacket } from './evidence.js'
import { generateRepoWikiEntries } from './generator.js'
import type { RepoWikiModelClient } from './model-client.js'
import { retrieveRepoWikiEntries } from './retrieval.js'

const SOURCE = 'RepoWikiProvider'
const DEFAULT_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000
const repoWikiScheduler = createContextScheduler()

export interface RepoWikiProviderOptions {
  enabled?: boolean
  store: Pick<ContextStore, 'listRepoWikiEntries' | 'getRepoWikiSummary' | 'saveRepoWikiEntries' | 'saveDiagnostic'>
  scheduler?: ContextScheduler
  getContextEngine?: (cwd: string) => ContextEngine
  modelClient?: RepoWikiModelClient
  modelConfig?: ModelConfig
  providerProtocol?: string
  modelProfileId?: string
  refreshMinIntervalMs?: number
}

export async function collectRepoWikiContext(request: ContextRequest, options: RepoWikiProviderOptions) {
  if (options.enabled === false) return disabledProviderResult('repo_wiki', SOURCE, request)
  const createdAt = nowFromRequest(request)
  try {
    const [entriesResult, summaryResult] = await Promise.all([
      options.store.listRepoWikiEntries({ limit: 50 }),
      options.store.getRepoWikiSummary(),
    ])
    const diagnostics = [...entriesResult.diagnostics, ...summaryResult.diagnostics]
    const entries = entriesResult.ok ? entriesResult.value : []
    const selected = retrieveRepoWikiEntries({
      query: request.userMessage,
      evidenceRequirements: request.evidenceRequirements,
      entries,
      limit: 6,
    })
    const sections = selected.length
      ? [section(
        [request.sessionId, SOURCE, request.userMessage],
        'repo_wiki',
        'Repo Wiki',
        renderRepoWikiSection(selected.map((item) => item.entry)),
        selected.flatMap((item) => item.entry.citations),
        76,
        Math.max(...selected.map((item) => item.entry.confidence)),
        'cached',
        SOURCE,
        { authority: 'derived_state', topic: 'code', conflictPolicy: 'render' },
      )]
      : []

    const activeEntryCount = summaryResult.ok ? summaryResult.value.activeEntries : 0
    const staleEntryCount = summaryResult.ok ? summaryResult.value.staleEntries : 0
    const queued = maybeQueueRepoWikiGeneration(request, options, activeEntryCount, staleEntryCount, createdAt)
    const status = sections.length ? 'cached' : queued ? 'indexing' : 'enabled'
    return {
      evidence: [],
      sections,
      diagnostics,
      health: providerHealth('repo_wiki', status, createdAt),
    }
  } catch (error) {
    return failedProviderResult('repo_wiki', SOURCE, request, error)
  }
}

function maybeQueueRepoWikiGeneration(request: ContextRequest, options: RepoWikiProviderOptions, activeEntryCount: number, staleEntryCount: number, startedAt: number): boolean {
  if (activeEntryCount > 0 && staleEntryCount === 0) return false
  if (!options.modelClient || !options.modelConfig) return false
  const scheduler = options.scheduler ?? repoWikiScheduler
  const scheduled = scheduler.enqueueBackground(request.cwd, 'repo_wiki_generate', async (signal) => {
    const engine = (options.getContextEngine ?? getContextEngine)(request.cwd)
    if (!engine.isIndexed()) return
    const evidence = buildRepoWikiEvidencePacket({ cwd: request.cwd, indexStore: engine.getStore(), now: () => startedAt })
    const generated = await generateRepoWikiEntries({
      cwd: request.cwd,
      projectKey: request.cwd,
      evidence,
      modelClient: options.modelClient!,
      model: {
        providerProtocol: options.providerProtocol ?? 'anthropic',
        modelId: options.modelConfig!.model,
        modelProfileId: options.modelProfileId,
      },
      modelRequest: {
        modelConfig: options.modelConfig!,
        cacheUser: request.sessionId,
        signal,
      },
      now: Date.now,
    })
    if (generated.entries.length) await options.store.saveRepoWikiEntries(generated.entries)
    for (const diagnostic of generated.diagnostics) await options.store.saveDiagnostic(diagnostic)
  }, { minIntervalMs: options.refreshMinIntervalMs ?? DEFAULT_REFRESH_MIN_INTERVAL_MS })
  return scheduled.accepted
}

function renderRepoWikiSection(entries: Array<{ title: string; kind: string; content: string; citations: Array<{ ref: string; line?: number }> }>): string {
  return entries.map((entry) => [
    `## ${entry.title}`,
    `Kind: ${entry.kind}`,
    entry.content,
    `Citations: ${entry.citations.map((citation) => `${citation.ref}${citation.line ? `:${citation.line}` : ''}`).join(', ')}`,
  ].join('\n')).join('\n\n')
}
```

- [ ] **Step 3: Export provider**

Modify `packages/core/src/context/repo-wiki/index.ts`:

```ts
export { collectRepoWikiContext } from './provider.js'
export type { RepoWikiProviderOptions } from './provider.js'
```

Modify `packages/core/src/context/providers/index.ts`:

```ts
export { collectRepoWikiContext } from '../repo-wiki/provider.js'
export type { RepoWikiProviderOptions } from '../repo-wiki/provider.js'
```

- [ ] **Step 4: Wire Session default provider**

Modify imports in `packages/core/src/session.ts`:

```ts
import { createProviderRepoWikiModelClient } from './context/repo-wiki/index.js'
```

Also add `collectRepoWikiContext` to the existing provider import from `./context/providers/index.js`.

Add `repo_wiki` provider before `code` in `getContextProviders()`:

```ts
{ id: 'repo_wiki', collect: async (request) => collectRepoWikiContext(request, {
  enabled: toggles.repo_wiki,
  store: await this.getContextStore(),
  scheduler: this.contextScheduler,
  modelClient: createProviderRepoWikiModelClient(this.provider),
  modelConfig: this.config.modelConfig,
  providerProtocol: this.contextProtocol,
  modelProfileId: this.modelProfile?.id,
}) },
{ id: 'code', collect: (request) => collectCodeContext(request, { enabled: toggles.code, scheduler: this.contextScheduler }) },
```

Keep `repo_wiki` before `code` so Wiki can satisfy broad architecture questions cheaply while `code` still supplies fresh code evidence for specific edits.

- [ ] **Step 5: Add Session tests**

Append to `packages/core/src/session-context.test.ts`:

```ts
it('includes repo_wiki in the default context provider list before code', async () => {
  const session = makeSession()
  const providerIds = (session as any).getContextProviders().map((provider: { id: string }) => provider.id)

  expect(providerIds.indexOf('repo_wiki')).toBeGreaterThanOrEqual(0)
  expect(providerIds.indexOf('repo_wiki')).toBeLessThan(providerIds.indexOf('code'))
})
```

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/providers/repo-wiki-provider.test.ts src/session-context.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
pnpm --filter @jdcagnet/core build
git diff --check
```

Expected: PASS.

Commit:

```bash
git add packages/core/src/context/repo-wiki/provider.ts packages/core/src/context/repo-wiki/index.ts packages/core/src/context/providers/index.ts packages/core/src/context/providers/repo-wiki-provider.test.ts packages/core/src/session.ts packages/core/src/session-context.test.ts
git commit -m "feat: add repo wiki context provider"
```

---

## Task 4: Retrieval Integration and Authoritative Ordering

**Goal:** Ensure Repo Wiki participates in context planning while live code evidence and current files remain more authoritative.

**Files:**

- Modify: `packages/core/src/context/orchestrator.ts`
- Modify: `packages/core/src/context/context-orchestrator.test.ts`
- Modify: `packages/core/src/context/context-product-evals.test.ts`

- [ ] **Step 1: Add orchestrator tests**

Append to `packages/core/src/context/context-orchestrator.test.ts`:

```ts
it('includes repo wiki sections when they satisfy evidence requirements', async () => {
  const result = await buildContextBundle({
    ...request,
    userMessage: 'Session 上下文注入架构是什么',
    evidenceRequirements: [{
      id: 'req_session',
      kind: 'relevant_code',
      reason: 'Need session evidence',
      query: 'Session context injection',
      priority: 'must',
      relatedFiles: ['packages/core/src/session.ts'],
      relatedSymbols: ['Session'],
      docRefs: [],
      languageHints: ['zh'],
    }],
  }, {
    store: makeStore(),
    providers: [{
      id: 'repo_wiki',
      collect: async () => providerResult([section({
        id: 'repo_wiki_session',
        kind: 'repo_wiki',
        title: 'Repo Wiki',
        content: 'Session injects context before model calls.',
        citations: [{ id: 'cit', type: 'file', ref: 'packages/core/src/session.ts', hash: 'hash_session' }],
        priority: 76,
        confidence: 0.9,
        freshness: 'cached',
        sourceProvider: 'RepoWikiProvider',
        ownership: { authority: 'derived_state', topic: 'code', conflictPolicy: 'render' },
      })]),
    }],
    includeAgentContract: true,
    now: () => 1,
    id: () => 'ctx_repo_wiki',
  })

  expect(result.bundle.sections.map((item) => item.kind)).toContain('repo_wiki')
  expect(result.renderedPrompt).toContain('Session injects context')
})

it('keeps fresh relevant_code ahead of repo_wiki for code edit turns', async () => {
  const result = await buildContextBundle({
    ...request,
    mode: 'code_edit',
    userMessage: '修改 packages/core/src/session.ts 的上下文注入',
  }, {
    store: makeStore(),
    providers: [
      {
        id: 'repo_wiki',
        collect: async () => providerResult([section({
          id: 'wiki',
          kind: 'repo_wiki',
          title: 'Repo Wiki',
          content: 'Session summary from generated Wiki.',
          citations: [{ id: 'wiki_cit', type: 'file', ref: 'packages/core/src/session.ts', hash: 'hash_session' }],
          priority: 76,
          confidence: 0.9,
          freshness: 'cached',
          sourceProvider: 'RepoWikiProvider',
          ownership: { authority: 'derived_state', topic: 'code', conflictPolicy: 'render' },
        })]),
      },
      {
        id: 'code',
        collect: async () => providerResult([section({
          id: 'code',
          kind: 'relevant_code',
          title: 'Relevant code',
          content: 'Fresh code snippet from packages/core/src/session.ts.',
          citations: [{ id: 'code_cit', type: 'file', ref: 'packages/core/src/session.ts', hash: 'hash_session_v2' }],
          priority: 90,
          confidence: 0.95,
          freshness: 'live',
          sourceProvider: 'CodeSignalProvider',
          ownership: { authority: 'code_evidence', topic: 'code', conflictPolicy: 'render' },
        })]),
      },
    ],
    now: () => 1,
    id: () => 'ctx_ordering',
  })

  const kinds = result.bundle.sections.map((item) => item.kind)
  expect(kinds.indexOf('relevant_code')).toBeLessThan(kinds.indexOf('repo_wiki'))
})
```

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-orchestrator.test.ts --no-file-parallelism
```

Expected before implementation: the first test may fail if planner suppresses `repo_wiki`; the second test may fail if ranking orders derived Wiki above live code.

- [ ] **Step 2: Adjust planner/ranker only if tests expose suppression**

If the first test fails because `repo_wiki` is not considered relevant, update planner relevance checks so `repo_wiki` is treated like code-supporting context for plan/review/code questions.

Use this rule in the planner file that selects section kinds:

```ts
const CODE_SUPPORT_SECTION_KINDS: ContextSectionKind[] = ['relevant_code', 'code_map', 'repo_wiki']
```

If the second test fails because `repo_wiki` outranks `relevant_code`, update ranking weights so live code remains ahead:

```ts
if (section.kind === 'relevant_code') score += 40
if (section.kind === 'repo_wiki') score += 18
if (section.ownership?.authority === 'code_evidence') score += 20
if (section.ownership?.authority === 'derived_state') score += 4
```

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-orchestrator.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 3: Add product eval**

Append to `packages/core/src/context/context-product-evals.test.ts`:

```ts
it('uses model-generated repo wiki for architecture recall while fresh code remains authoritative', async () => {
  const wiki = section({
    id: 'wiki_session',
    kind: 'repo_wiki',
    title: 'Repo Wiki',
    content: 'Generated Wiki: Session coordinates context injection.',
    citations: [{ id: 'wiki_cit', type: 'file', ref: 'packages/core/src/session.ts', hash: 'hash_old' }],
    priority: 76,
    confidence: 0.9,
    freshness: 'cached',
    sourceProvider: 'RepoWikiProvider',
    ownership: { authority: 'derived_state', topic: 'code', conflictPolicy: 'render' },
  })
  const code = section({
    id: 'code_session',
    kind: 'relevant_code',
    title: 'Relevant code',
    content: 'Fresh code: Session injects context through injectContextForRunLoop.',
    citations: [{ id: 'code_cit', type: 'file', ref: 'packages/core/src/session.ts', hash: 'hash_new' }],
    priority: 90,
    confidence: 0.95,
    freshness: 'live',
    sourceProvider: 'CodeSignalProvider',
    ownership: { authority: 'code_evidence', topic: 'code', conflictPolicy: 'render' },
  })

  const result = await buildContextBundle(request({
    userMessage: '解释 Session 上下文注入，然后修改相关代码',
    mode: 'code_edit',
  }), {
    store: makeEvalStore(),
    providers: [
      { id: 'repo_wiki', collect: async () => providerResult([wiki]) },
      { id: 'code', collect: async () => providerResult([code]) },
    ],
    now: () => 1,
    id: () => 'ctx_repo_wiki_eval',
  })

  expect(result.renderedPrompt).toContain('Generated Wiki: Session coordinates context injection.')
  expect(result.renderedPrompt.indexOf('Fresh code: Session injects context')).toBeLessThan(result.renderedPrompt.indexOf('Generated Wiki: Session coordinates context injection.'))
})
```

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-product-evals.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-orchestrator.test.ts src/context/context-product-evals.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core build
git diff --check
```

Expected: PASS.

Commit:

```bash
git add packages/core/src/context/orchestrator.ts packages/core/src/context/context-orchestrator.test.ts packages/core/src/context/context-product-evals.test.ts
git commit -m "feat: rank repo wiki in context retrieval"
```

---

## Task 5: File Change Invalidation

**Goal:** Mark generated Wiki entries stale whenever a cited file changes so stale summaries cannot enter normal context bundles.

**Files:**

- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/session-context.test.ts`
- Modify: `packages/core/src/context/context-product-evals.test.ts`

- [ ] **Step 1: Add failing session invalidation test**

Append to `packages/core/src/session-context.test.ts` near existing context invalidation tests:

```ts
it('invalidates repo wiki entries after a cited file changes', async () => {
  const store = {
    invalidateByFileHash: vi.fn(async () => ({ ok: true, value: { invalidatedFacts: 0 }, diagnostics: [] })),
    invalidateRepoWikiByFileHash: vi.fn(async () => ({ ok: true, value: { invalidatedEntries: 1 }, diagnostics: [] })),
    saveDiagnostic: vi.fn(async () => ({ ok: true, value: undefined, diagnostics: [] })),
  }
  const session = makeSession({ contextStore: store as any })
  session.fileTracker.recordChange({ filePath: 'packages/core/src/session.ts', kind: 'modified' })
  await writeFile(path.join(session.config.cwd, 'packages/core/src/session.ts'), 'export class Session {}\n')

  await (session as any).invalidateStaleFileFactsAfterRunLoop()

  expect(store.invalidateByFileHash).toHaveBeenCalledWith('packages/core/src/session.ts', expect.any(String))
  expect(store.invalidateRepoWikiByFileHash).toHaveBeenCalledWith('packages/core/src/session.ts', expect.any(String))
})
```

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/session-context.test.ts --no-file-parallelism
```

Expected: FAIL because session invalidation only calls `invalidateByFileHash()`.

- [ ] **Step 2: Extend invalidation**

Modify `packages/core/src/session.ts` inside `invalidateStaleFileFactsAfterRunLoop()`:

```ts
const hash = hashContent(content)
await store.invalidateByFileHash(filePath, hash)
await store.invalidateRepoWikiByFileHash(filePath, hash)
```

Keep the existing catch block. Repo Wiki invalidation is best-effort and must not block foreground chat.

- [ ] **Step 3: Add product eval for stale Wiki exclusion**

Append to `packages/core/src/context/context-product-evals.test.ts`:

```ts
it('does not retrieve stale repo wiki after cited file hash changes', async () => {
  const store = makeEvalStore()
  await store.saveRepoWikiEntries([{
    id: 'wiki_stale',
    projectKey: '/repo',
    kind: 'architecture',
    title: 'Old Session summary',
    content: 'Old generated Session summary.',
    citations: [{ id: 'cit_old', type: 'file', ref: 'packages/core/src/session.ts', hash: 'hash_old' }],
    relatedFiles: ['packages/core/src/session.ts'],
    relatedSymbols: ['Session'],
    confidence: 0.9,
    freshness: 'cached',
    generatedBy: { providerProtocol: 'anthropic', modelId: 'claude-sonnet-4' },
    evidenceHash: 'evidence_old',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  }])

  await store.invalidateRepoWikiByFileHash('packages/core/src/session.ts', 'hash_new')
  const entries = await store.listRepoWikiEntries()

  expect(entries.value).toEqual([])
})
```

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/session-context.test.ts src/context/context-product-evals.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
pnpm --filter @jdcagnet/core build
git diff --check
```

Expected: PASS.

Commit:

```bash
git add packages/core/src/session.ts packages/core/src/session-context.test.ts packages/core/src/context/context-product-evals.test.ts
git commit -m "feat: invalidate repo wiki on file changes"
```

---

## Task 6: Context Inspect and UI Visibility

**Goal:** Show Repo Wiki health, sections, and diagnostics through existing context inspection and Chinese-first panels.

**Files:**

- Modify: `packages/core/src/tools/context-inspect.ts`
- Modify: `packages/core/src/tools/context-tools.test.ts`
- Modify: `packages/ui/src/components/context/ContextPanelPrimitives.tsx`
- Modify: `packages/ui/src/components/context/ContextCurrentPanel.tsx`
- Modify: `packages/ui/src/components/context/ContextAdvancedDiagnosticsPanel.tsx`
- Modify: `packages/ui/src/components/context/context-panels.test.tsx`
- Modify: `packages/ui/src/stores/context-store.test.tsx`

- [ ] **Step 1: Add failing inspect schema test**

Append to `packages/core/src/tools/context-tools.test.ts`:

```ts
it('includes repo wiki summary in context inspect payload', async () => {
  const store = makeStore({
    repoWikiSummary: { activeEntries: 2, staleEntries: 1, lastGeneratedAt: 1_700_000_000_000, lastModelId: 'claude-sonnet-4' },
  })

  const payload = await inspectContext({ includeAdvancedDiagnostics: true }, { store: store as any, cwd: '/repo', now: () => 1_700_000_000_100 })

  expect(payload.repoWiki).toEqual({
    activeEntries: 2,
    staleEntries: 1,
    lastGeneratedAt: 1_700_000_000_000,
    lastModelId: 'claude-sonnet-4',
  })
})
```

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/tools/context-tools.test.ts --no-file-parallelism
```

Expected: FAIL because `ContextInspectPayload` has no `repoWiki`.

- [ ] **Step 2: Extend inspect payload**

Modify `packages/core/src/tools/context-inspect.ts` imports:

```ts
import type { RepoWikiSummary } from '../context/repo-wiki/index.js'
```

Add schema:

```ts
const RepoWikiSummarySchema = z.object({
  activeEntries: z.number().int().nonnegative(),
  staleEntries: z.number().int().nonnegative(),
  lastGeneratedAt: z.number().int().nonnegative().optional(),
  lastModelId: z.string().optional(),
  lastDiagnostic: z.string().optional(),
})
```

Extend `ContextInspectPayloadSchema`:

```ts
repoWiki: RepoWikiSummarySchema.optional(),
```

Load summary in `inspectContext()`:

```ts
const [bundles, acceptedProjectFacts, storedDiagnostics, schemaInfo, repoWikiSummary, advancedDiagnostics, rejectedMemoryReview] = await Promise.all([
  store.listBundleSnapshots(input.sessionId),
  store.listAcceptedProjectFacts(),
  store.listDiagnostics(),
  store.getSchemaInfo(),
  store.getRepoWikiSummary(),
  input.includeAdvancedDiagnostics
    ? store.listAdvancedDiagnostics({ sessionId: input.sessionId, includeNoop: true })
    : Promise.resolve(successResult(emptyAdvancedDiagnostics())),
  input.includeExpiredRejected
    ? store.listRejectedCandidates({ sessionId: input.sessionId, includeExpired: true })
    : Promise.resolve(successResult([])),
])
```

Add `repoWikiSummary` to diagnostics collection and failure checks, then set:

```ts
repoWiki: repoWikiSummary.ok ? repoWikiSummary.value : undefined,
```

Add to `emptyPayload()`:

```ts
repoWiki: undefined,
```

- [ ] **Step 3: Add UI label tests**

Append to `packages/ui/src/components/context/context-panels.test.tsx`:

```tsx
it('labels repo wiki sections in Chinese', () => {
  const html = renderToStaticMarkup(<ContextCurrentPanel payload={{
    ...payload,
    bundle: {
      ...payload.bundle!,
      sections: [{
        ...payload.bundle!.sections[0],
        id: 'repo_wiki_1',
        kind: 'repo_wiki',
        title: 'Repo Wiki',
        content: 'Session injects context.',
        sourceProvider: 'RepoWikiProvider',
      }],
    },
  }} loading={false} error={null} />)

  expect(html).toContain('仓库 Wiki')
  expect(html).toContain('RepoWikiProvider')
})

it('shows repo wiki summary in advanced diagnostics', () => {
  const html = renderToStaticMarkup(<ContextAdvancedDiagnosticsPanel
    inspect={{ data: { ...payload, repoWiki: { activeEntries: 2, staleEntries: 1, lastGeneratedAt: 1_700_000_000_000, lastModelId: 'claude-sonnet-4' }, advancedDiagnostics: payload.advancedDiagnostics }, loading: false, error: null }}
    harvest={{ data: null, loading: false, error: null }}
    memoryReview={{ data: null, loading: false, error: null }}
    providerHealth={{ data: null, loading: false, error: null }}
    refresh={{ data: null, loading: false, error: null }}
    onReloadDiagnostics={() => {}}
    onReindexCode={() => {}}
    onReadProviderStatus={() => {}}
  />)

  expect(html).toContain('仓库 Wiki')
  expect(html).toContain('claude-sonnet-4')
  expect(html).toContain('2')
})
```

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/components/context/context-panels.test.tsx --no-file-parallelism
```

Expected: FAIL until UI labels and summary render exist.

- [ ] **Step 4: Add labels and injection reason**

Modify `packages/ui/src/components/context/ContextPanelPrimitives.tsx`:

```ts
repo_wiki: '仓库 Wiki',
```

Modify `packages/ui/src/components/context/ContextCurrentPanel.tsx`:

```ts
if (section.kind === 'repo_wiki') return '仓库 Wiki 命中'
```

- [ ] **Step 5: Render advanced summary**

Modify `packages/ui/src/components/context/ContextAdvancedDiagnosticsPanel.tsx` before refresh state:

```tsx
{payload?.repoWiki && (
  <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-[11px]">
    <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">仓库 Wiki</div>
    <div className="mt-2 grid gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(90px,1fr))]">
      <Metric label="可用条目" value={payload.repoWiki.activeEntries} />
      <Metric label="过期条目" value={payload.repoWiki.staleEntries} />
      <Metric label="模型" value={payload.repoWiki.lastModelId ?? '未报告'} />
      <Metric label="生成时间" value={payload.repoWiki.lastGeneratedAt ? formatDate(payload.repoWiki.lastGeneratedAt) : '未报告'} />
    </div>
    {payload.repoWiki.lastDiagnostic && (
      <div className="mt-2 whitespace-normal break-words text-[10px] text-[var(--muted)] [overflow-wrap:anywhere]">{payload.repoWiki.lastDiagnostic}</div>
    )}
  </div>
)}
```

- [ ] **Step 6: Run UI/core tests and commit**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/tools/context-tools.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/ui exec vitest run src/components/context/context-panels.test.tsx src/stores/context-store.test.tsx --no-file-parallelism
pnpm --filter @jdcagnet/core build
pnpm --filter @jdcagnet/ui build
git diff --check
```

Expected: PASS.

Commit:

```bash
git add packages/core/src/tools/context-inspect.ts packages/core/src/tools/context-tools.test.ts packages/ui/src/components/context/ContextPanelPrimitives.tsx packages/ui/src/components/context/ContextCurrentPanel.tsx packages/ui/src/components/context/ContextAdvancedDiagnosticsPanel.tsx packages/ui/src/components/context/context-panels.test.tsx packages/ui/src/stores/context-store.test.tsx
git commit -m "feat: show repo wiki context diagnostics"
```

---

## Task 7: Design Doc Update and Final Product Eval

**Goal:** Record the Phase 8 implementation decision and prove the complete flow with a product-level test.

**Files:**

- Modify: `packages/core/src/context/context-product-evals.test.ts`
- Modify: `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`

- [ ] **Step 1: Add final product eval**

Append to `packages/core/src/context/context-product-evals.test.ts`:

```ts
it('generates, stores, retrieves, and invalidates model-generated repo wiki with citations', async () => {
  const cwd = tempProject()
  writeProjectFile(cwd, 'README.md', '# Repo\n\nUse pnpm test for verification.\n')
  writeProjectFile(cwd, 'packages/core/src/session.ts', 'export class Session {}\n')
  const engine = new ContextEngine(cwd)
  await engine.index()
  const store = await openContextStore({ dbPath: makeDbPath(), cwd, now: () => 1 })
  const evidence = buildRepoWikiEvidencePacket({ cwd, indexStore: engine.getStore(), now: () => 1 })
  const firstPacket = evidence.packets.find((packet) => packet.ref === 'packages/core/src/session.ts')!

  const generated = await generateRepoWikiEntries({
    cwd,
    projectKey: cwd,
    evidence,
    modelClient: {
      completeRepoWiki: async () => JSON.stringify({
        schemaVersion: 1,
        action: 'save',
        sections: [{
          kind: 'architecture',
          title: 'Session architecture',
          content: 'Session owns context injection for model calls.',
          citationPacketIds: [firstPacket.id],
          relatedFiles: ['packages/core/src/session.ts'],
          relatedSymbols: ['Session'],
          confidence: 0.92,
        }],
      }),
    },
    model: { providerProtocol: 'anthropic', modelId: 'claude-sonnet-4', modelProfileId: 'standard' },
    now: () => 2,
  })
  await store.saveRepoWikiEntries(generated.entries)

  const bundle = await buildContextBundle(makeEvalRequest({ cwd, userMessage: 'Session 架构是什么', mode: 'plan' }), {
    store,
    providers: [{ id: 'repo_wiki', collect: (request) => collectRepoWikiContext(request, { store }) }],
    now: () => 3,
    id: () => 'ctx_repo_wiki_final',
  })
  expect(bundle.renderedPrompt).toContain('Session owns context injection')

  await store.invalidateRepoWikiByFileHash('packages/core/src/session.ts', 'changed_hash')
  const afterInvalidation = await buildContextBundle(makeEvalRequest({ cwd, userMessage: 'Session 架构是什么', mode: 'plan' }), {
    store,
    providers: [{ id: 'repo_wiki', collect: (request) => collectRepoWikiContext(request, { store }) }],
    now: () => 4,
    id: () => 'ctx_repo_wiki_stale',
  })
  expect(afterInvalidation.renderedPrompt).not.toContain('Session owns context injection')
})
```

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-product-evals.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 2: Update design document**

Modify `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md` under the Repo Wiki and recommended implementation sections:

```md
Phase 8 implementation decision:

- Repo Wiki is model-generated from a product-built evidence packet, not manually authored and not derived from hidden reasoning.
- Evidence packets are assembled from the existing code index, repo map, repository docs, and package scripts.
- Model output must be strict JSON. Each Wiki section must cite evidence packet ids that resolve to file citations with hashes.
- Accepted Wiki rows are stored in the existing context DB as `repo_wiki_entries`.
- Repo Wiki is a derived acceleration layer. Fresh `relevant_code`, file reads, and current index results override generated summaries.
- The `repo_wiki` provider reads stored rows on the foreground path and schedules background generation when entries are missing or stale.
- File hash invalidation marks Wiki entries stale when cited files change.
- Context Inspect and the UI expose active/stale Wiki counts and show `repo_wiki` sections as `仓库 Wiki`.
```

- [ ] **Step 3: Run final gates**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/repo-wiki/repo-wiki.test.ts src/context/providers/repo-wiki-provider.test.ts src/context/store.test.ts src/context/context-orchestrator.test.ts src/context/context-product-evals.test.ts src/tools/context-tools.test.ts src/session-context.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core build
pnpm --filter @jdcagnet/ui exec vitest run src/components/context/context-panels.test.tsx src/stores/context-store.test.tsx --no-file-parallelism
pnpm --filter @jdcagnet/ui build
git diff --check
```

Expected: PASS.

- [ ] **Step 4: Commit**

Commit:

```bash
git add packages/core/src/context/context-product-evals.test.ts docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md
git commit -m "test: cover model generated repo wiki flow"
```

---

## Implementation Order

Use this dependency order:

1. Task 1 must complete first because every following task needs the persisted Wiki row type and DB methods.
2. Task 2 depends on Task 1 types but does not need provider wiring.
3. Task 3 depends on Tasks 1 and 2.
4. Task 4 depends on Task 3.
5. Task 5 depends on Task 1 and can run after Task 3.
6. Task 6 depends on Tasks 1 and 3.
7. Task 7 runs after all implementation tasks.

Do not parallelize edits to these files:

- `packages/core/src/session.ts`
- `packages/core/src/context/store.ts`
- `packages/core/src/context/context-product-evals.test.ts`
- `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`

## Risk Checklist

- Model output is never stored unless every saved section has at least one validated file citation.
- `repo_wiki` provider must not run model generation on the foreground context injection path.
- Stale Wiki entries are excluded from normal retrieval.
- Repo Wiki sections must not satisfy fresh-read mutation gates. They are planning context, not file read evidence.
- UI labels are Chinese-first, but paths and model ids stay literal.
- Store migration must work from schema versions 0, 1, and 2 to version 3.
