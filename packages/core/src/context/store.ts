import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import initSqlJs, { type Database, type SqlValue } from 'sql.js'
import {
  ContextBundleSchema,
  ContextDiagnosticSchema,
  ContextFactSchema,
  DistillerEnvelopeSchema,
  HarvestJobSchema,
  RawEvidenceSchema,
} from './schemas.js'
import type {
  ContextBundle,
  ContextCitation,
  ContextDiagnostic,
  ContextFact,
  ContextFactKind,
  ContextFactStatus,
  ContextFreshness,
  ContextOrigin,
  ContextScope,
  HarvestJob,
  RawEvidence,
} from './types.js'
import {
  CONTEXT_SCHEMA_VERSION_KEY,
  CONTEXT_STORE_SCHEMA_VERSION,
  createContextStoreSchemaStatements,
  getContextStoreMigrationStatements,
} from './migrations/schema.js'
import { redactForDurableStorage } from './redaction.js'
import { rejectUnsafeDurableFact } from './safety.js'
import type { CitationValidationSources } from './citations.js'
import { kindFromEnvelope, scopeFromEnvelope, confidenceFromEnvelope, contentFromEnvelope } from './harvest.js'
import { validateDistillerOutput } from './distillers/index.js'

export { CONTEXT_STORE_SCHEMA_VERSION }

export interface ContextStoreQuotas {
  maxFacts: number
  maxBundleSnapshots: number
  maxRejectedCandidates: number
  rawEvidenceTtlMs: number
  staleHarvestJobTtlMs: number
}

export interface ContextStoreOpenOptions {
  dbPath?: string
  cwd?: string
  projectRoot?: string
  now?: () => number
  quotas?: Partial<ContextStoreQuotas>
}

export interface ContextStoreResult<T = void> {
  ok: boolean
  value: T
  diagnostics: ContextDiagnostic[]
}

export interface ContextFactQuery {
  scope?: ContextScope
  kinds?: ContextFactKind[]
  freshness?: ContextFreshness
  status?: ContextFactStatus
  minConfidence?: number
  citationRef?: string
  citationType?: string
  includeExpired?: boolean
  includeStale?: boolean
  includeInactive?: boolean
  limit?: number
  orderBy?: 'updated_asc' | 'updated_desc' | 'created_asc' | 'created_desc' | 'confidence_desc'
}

export interface RejectedCandidateRecord {
  id: string
  sessionId: string
  status: 'rejected' | 'pending_review' | 'accepted'
  candidate: unknown
  rejectionReason: string
  validationErrors: string[]
  createdAt: number
  expiresAt: number
  visibleInPrimaryUi: boolean
}

export interface RejectCandidateOptions {
  id?: string
  sessionId?: string
  createdAt?: number
  ttlMs?: number
  validationErrors?: string[]
  status?: 'rejected' | 'pending_review'
  visibleInPrimaryUi?: boolean
}

export interface QuotaEnforcementResult {
  deletedFacts: number
  deletedBundles: number
  deletedRawEvidence: number
  deletedRejectedCandidates: number
  repairedHarvestJobs?: number
}

export interface ContextStoreSchemaInfo {
  version: number
  dbPath: string
  backupPath?: string
}

export interface ListRejectedCandidatesOptions {
  sessionId?: string
  includeExpired?: boolean
}

export interface ListAdvancedDiagnosticsOptions {
  sessionId?: string
  includeNoop?: boolean
  limit?: number
}

export interface ContextAdvancedDiagnostics {
  rejected: RejectedCandidateRecord[]
  diagnostics: ContextDiagnostic[]
  harvestJobs: HarvestJob[]
}

export interface ContextStore {
  saveRawEvidence(evidence: RawEvidence): Promise<ContextStoreResult>
  saveFact(fact: ContextFact): Promise<ContextStoreResult>
  saveHarvestJob(job: HarvestJob): Promise<ContextStoreResult>
  updateHarvestJob(job: HarvestJob): Promise<ContextStoreResult>
  listHarvestJobs(sessionId?: string): Promise<ContextStoreResult<HarvestJob[]>>
  rejectCandidate(candidate: unknown, reason: string, options?: RejectCandidateOptions): Promise<ContextStoreResult<RejectedCandidateRecord | null>>
  saveBundleSnapshot(bundle: ContextBundle): Promise<ContextStoreResult>
  saveDiagnostic(diagnostic: ContextDiagnostic): Promise<ContextStoreResult>
  queryFacts(query?: ContextFactQuery): Promise<ContextStoreResult<ContextFact[]>>
  listAcceptedProjectFacts(query?: Omit<ContextFactQuery, 'scope'>): Promise<ContextStoreResult<ContextFact[]>>
  listAdvancedDiagnostics(options?: ListAdvancedDiagnosticsOptions): Promise<ContextStoreResult<ContextAdvancedDiagnostics>>
  invalidateByFileHash(filePath: string, hash: string): Promise<ContextStoreResult<{ invalidatedFacts: number }>>
  enforceQuotas(): Promise<ContextStoreResult<QuotaEnforcementResult>>
  getSchemaInfo(): Promise<ContextStoreResult<ContextStoreSchemaInfo>>
  listBundleSnapshots(sessionId?: string): Promise<ContextStoreResult<ContextBundle[]>>
  listRawEvidence(sessionId?: string): Promise<ContextStoreResult<RawEvidence[]>>
  listRejectedCandidates(options?: ListRejectedCandidatesOptions): Promise<ContextStoreResult<RejectedCandidateRecord[]>>
  approvePendingCandidate(id: string): Promise<ContextStoreResult<ContextFact | null>>
  rejectPendingCandidate(id: string): Promise<ContextStoreResult<RejectedCandidateRecord | null>>
  listDiagnostics(): Promise<ContextStoreResult<ContextDiagnostic[]>>
  withWriteBatch?<T>(operation: string, fn: () => Promise<T> | T): Promise<ContextStoreResult<T>>
}

const DEFAULT_CONTEXT_STORE_QUOTAS: ContextStoreQuotas = {
  maxFacts: Number.POSITIVE_INFINITY,
  maxBundleSnapshots: 50,
  maxRejectedCandidates: 100,
  rawEvidenceTtlMs: 7 * 24 * 60 * 60 * 1000,
  staleHarvestJobTtlMs: 24 * 60 * 60 * 1000,
}

interface SharedContextDatabase {
  db: Database
  dbPath: string
  backupPath?: string
  stores: Map<string, ContextStore>
}

const sharedContextDatabases = new Map<string, Promise<SharedContextDatabase>>()

export async function openContextStore(options: ContextStoreOpenOptions = {}): Promise<ContextStore> {
  const projectRoot = resolveProjectRoot(options)
  const dbPath = options.dbPath ?? projectContextDbPath(projectRoot)
  const projectKey = normalizeProjectRoot(projectRoot)
  const now = options.now ?? Date.now
  const quotas = { ...DEFAULT_CONTEXT_STORE_QUOTAS, ...options.quotas }

  try {
    const shared = await openSharedContextDatabase(dbPath, now, projectKey)
    const existing = shared.stores.get(projectKey)
    if (existing) return existing

    const store = new SqlJsContextStore(shared.db, shared.dbPath, projectKey, now, quotas, shared.backupPath)
    store.persist()
    shared.stores.set(projectKey, store)
    return store
  } catch (error) {
    return new UnavailableContextStore(dbPath, createStoreDiagnostic(error, 'Context store unavailable'))
  }
}

export async function closeContextStore(options: ContextStoreOpenOptions = {}): Promise<void> {
  const projectRoot = resolveProjectRoot(options)
  const dbPath = options.dbPath ?? projectContextDbPath(projectRoot)
  const registryKey = contextDatabaseRegistryKey(dbPath)
  const pending = sharedContextDatabases.get(registryKey)
  if (!pending) return
  sharedContextDatabases.delete(registryKey)
  try {
    const shared = await pending
    persistSharedContextDatabase(shared)
    shared.stores.clear()
    shared.db.close()
  } catch {
    // If opening failed, the registry entry is already gone.
  }
}

export async function closeAllContextStores(): Promise<void> {
  const pendingStores = [...sharedContextDatabases.values()]
  sharedContextDatabases.clear()
  await Promise.all(pendingStores.map(async (pending) => {
    try {
      const shared = await pending
      persistSharedContextDatabase(shared)
      shared.stores.clear()
      shared.db.close()
    } catch {
      // Best-effort cleanup for failed opens.
    }
  }))
}

async function openSharedContextDatabase(dbPath: string, now: () => number, projectKey: string): Promise<SharedContextDatabase> {
  const registryKey = contextDatabaseRegistryKey(dbPath)
  const existing = sharedContextDatabases.get(registryKey)
  if (existing) return existing

  const pending = createSharedContextDatabase(path.resolve(dbPath), now, projectKey).catch((error) => {
    sharedContextDatabases.delete(registryKey)
    throw error
  })
  sharedContextDatabases.set(registryKey, pending)
  return pending
}

async function createSharedContextDatabase(dbPath: string, now: () => number, projectKey: string): Promise<SharedContextDatabase> {
  mkdirSync(path.dirname(dbPath), { recursive: true })
  const SQL = await initSqlJs()
  const fallbackUnknownProjectRows = path.resolve(dbPath) === path.resolve(projectContextDbPath(projectKey))
  const { db, backupPath } = initializeDatabase(SQL, dbPath, now, projectKey, fallbackUnknownProjectRows)
  return { db, dbPath, backupPath, stores: new Map() }
}

function contextDatabaseRegistryKey(dbPath: string): string {
  return path.resolve(dbPath)
}

function persistSharedContextDatabase(shared: SharedContextDatabase): void {
  writeFileSync(shared.dbPath, Buffer.from(shared.db.export()))
}

const PROJECT_SCOPED_TABLES = [
  'raw_evidence',
  'context_facts',
  'context_bundles',
  'harvest_jobs',
  'memory_records',
  'context_diagnostics',
  'rejected_candidates',
] as const

const PROJECT_SCOPED_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_raw_evidence_project_session ON raw_evidence(project_key, session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_context_facts_project_scope ON context_facts(project_key, scope)`,
  `CREATE INDEX IF NOT EXISTS idx_context_facts_project_lifecycle ON context_facts(project_key, status, canonical_key)`,
  `CREATE INDEX IF NOT EXISTS idx_context_bundles_project_session ON context_bundles(project_key, session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_harvest_jobs_project_session ON harvest_jobs(project_key, session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_records_project_scope ON memory_records(project_key, scope)`,
  `CREATE INDEX IF NOT EXISTS idx_context_diagnostics_project_created ON context_diagnostics(project_key, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_rejected_candidates_project_session ON rejected_candidates(project_key, session_id)`,
] as const

function resolveProjectRoot(options: ContextStoreOpenOptions): string {
  return normalizeProjectRoot(options.projectRoot ?? options.cwd ?? process.cwd())
}

function normalizeProjectRoot(projectRoot: string): string {
  return path.resolve(projectRoot)
}

function projectContextDbPath(projectRoot: string): string {
  return path.join(normalizeProjectRoot(projectRoot), '.jdcagnet', 'context-engine', 'context.db')
}

function scopedId(projectKey: string, id: string): string {
  return `${createHash('sha256').update(projectKey).digest('hex').slice(0, 16)}:${id}`
}

function normalizeFileCitationRef(ref: string, projectKey: string): string {
  const absolute = path.isAbsolute(ref) ? path.resolve(ref) : path.resolve(projectKey, ref)
  const relative = path.relative(projectKey, absolute)
  const stable = relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : ref
  return stable.split(path.sep).join('/')
}

type SqlJsStatic = Awaited<ReturnType<typeof initSqlJs>>

function initializeDatabase(SQL: SqlJsStatic, dbPath: string, now: () => number, projectKey: string, fallbackUnknownProjectRows: boolean): { db: Database; backupPath?: string } {
  const db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database()
  const version = readSchemaVersion(db)

  if (version === CONTEXT_STORE_SCHEMA_VERSION) {
    ensureSchema(db, projectKey, fallbackUnknownProjectRows)
    return { db }
  }

  if (version === null) {
    applyStatements(db, createContextStoreSchemaStatements())
    ensureSchema(db, projectKey, fallbackUnknownProjectRows)
    return { db }
  }

  const migration = getContextStoreMigrationStatements(version)
  if (migration) {
    applyStatements(db, migration)
    ensureSchema(db, projectKey, fallbackUnknownProjectRows)
    return { db }
  }

  db.close()
  const backupPath = `${dbPath}.backup-${Math.floor(now())}`
  if (existsSync(dbPath)) copyFileSync(dbPath, backupPath)
  const rebuilt = new SQL.Database()
  applyStatements(rebuilt, createContextStoreSchemaStatements())
  ensureSchema(rebuilt, projectKey, fallbackUnknownProjectRows)
  return { db: rebuilt, backupPath }
}

function ensureSchema(db: Database, projectKey: string, fallbackUnknownProjectRows: boolean): void {
  applyStatements(db, createContextStoreSchemaStatements())
  ensureProjectIsolationSchema(db, projectKey, fallbackUnknownProjectRows)
}

function ensureProjectIsolationSchema(db: Database, projectKey: string, fallbackUnknownProjectRows: boolean): void {
  for (const table of PROJECT_SCOPED_TABLES) ensureColumn(db, table, 'project_key', 'TEXT')
  ensureColumn(db, 'raw_evidence', 'evidence_id', 'TEXT')
  ensureColumn(db, 'context_facts', 'fact_id', 'TEXT')
  ensureColumn(db, 'context_facts', 'session_id', 'TEXT')
  ensureColumn(db, 'context_facts', 'origin_json', 'TEXT')
  ensureColumn(db, 'context_facts', 'tags_json', 'TEXT')
  ensureColumn(db, 'context_facts', 'related_files_json', 'TEXT')
  ensureColumn(db, 'context_facts', 'related_symbols_json', 'TEXT')
  ensureColumn(db, 'context_facts', 'related_tasks_json', 'TEXT')
  ensureColumn(db, 'context_facts', 'status', "TEXT DEFAULT 'active'")
  ensureColumn(db, 'context_facts', 'canonical_key', 'TEXT')
  ensureColumn(db, 'context_facts', 'supersedes_json', 'TEXT')
  ensureColumn(db, 'context_facts', 'conflicts_with_json', 'TEXT')
  ensureColumn(db, 'context_facts', 'archived_at', 'INTEGER')
  ensureColumn(db, 'context_facts', 'lifecycle_reason', 'TEXT')
  ensureColumn(db, 'context_bundles', 'bundle_id', 'TEXT')
  ensureColumn(db, 'harvest_jobs', 'job_id', 'TEXT')
  ensureColumn(db, 'memory_records', 'memory_id', 'TEXT')
  ensureColumn(db, 'context_diagnostics', 'diagnostic_id', 'TEXT')
  ensureColumn(db, 'context_diagnostics', 'visible_in_primary_ui', 'INTEGER DEFAULT 1')
  ensureColumn(db, 'rejected_candidates', 'candidate_id', 'TEXT')
  ensureColumn(db, 'rejected_candidates', 'visible_in_primary_ui', 'INTEGER DEFAULT 1')
  ensureColumn(db, 'harvest_jobs', 'visible_in_primary_ui', 'INTEGER DEFAULT 1')
  backfillProjectIsolationRows(db, fallbackUnknownProjectRows ? projectKey : undefined)
  backfillFactProvenanceRows(db, projectKey)
  backfillFactLifecycleRows(db)
  applyStatements(db, [...PROJECT_SCOPED_INDEXES])
}

const LOGICAL_ID_BACKFILLS = [
  ['raw_evidence', 'evidence_id'],
  ['context_facts', 'fact_id'],
  ['context_bundles', 'bundle_id'],
  ['harvest_jobs', 'job_id'],
  ['memory_records', 'memory_id'],
  ['context_diagnostics', 'diagnostic_id'],
  ['rejected_candidates', 'candidate_id'],
] as const

type LifecycleFact = ContextFact & {
  status: ContextFactStatus
  canonicalKey: string
  supersedes: string[]
  conflictsWith: string[]
}

interface StoredLifecycleFact {
  scopedId: string
  fact: ContextFact
}

type FactLifecycleResolution =
  | { action: 'insert'; fact: LifecycleFact; superseded: ContextFact[] }
  | { action: 'merge'; fact: LifecycleFact; targetScopedId: string; superseded: [] }

function backfillProjectIsolationRows(db: Database, fallbackProjectKey?: string): void {
  const sessionProjectKeys = backfillRawEvidenceProjectKeys(db, fallbackProjectKey)
  backfillSessionOwnedRows(db, sessionProjectKeys, fallbackProjectKey)
  backfillUnownedRows(db, fallbackProjectKey)
  for (const [table, column] of LOGICAL_ID_BACKFILLS) {
    db.run(`UPDATE ${table} SET ${column} = id WHERE ${column} IS NULL OR ${column} = ''`)
  }
}

function backfillRawEvidenceProjectKeys(db: Database, fallbackProjectKey?: string): Map<string, string> {
  const sessionProjectKeys = new Map<string, string>()
  const ambiguousSessions = new Set<string>()
  for (const row of selectDbRows(db, 'SELECT id, session_id, cwd, project_key FROM raw_evidence')) {
    const id = String(row.id)
    const sessionId = stringOrUndefined(row.session_id)
    let projectKey = stringOrUndefined(row.project_key)
    if (!projectKey) {
      const cwd = stringOrUndefined(row.cwd)
      projectKey = cwd ? normalizeProjectRoot(cwd) : fallbackProjectKey
      if (projectKey) db.run('UPDATE raw_evidence SET project_key = ? WHERE id = ?', [projectKey, id])
    }
    if (sessionId && projectKey && !ambiguousSessions.has(sessionId)) {
      const existing = sessionProjectKeys.get(sessionId)
      if (!existing) {
        sessionProjectKeys.set(sessionId, projectKey)
      } else if (existing !== projectKey) {
        sessionProjectKeys.delete(sessionId)
        ambiguousSessions.add(sessionId)
      }
    }
  }
  return sessionProjectKeys
}

function backfillSessionOwnedRows(db: Database, sessionProjectKeys: Map<string, string>, fallbackProjectKey?: string): void {
  const sessionOwnedTables = ['context_facts', 'context_bundles', 'harvest_jobs', 'rejected_candidates'] as const
  for (const table of sessionOwnedTables) {
    for (const row of selectDbRows(db, `SELECT id, session_id, project_key FROM ${table} WHERE project_key IS NULL OR project_key = ''`)) {
      const sessionId = stringOrUndefined(row.session_id)
      const projectKey = sessionId ? sessionProjectKeys.get(sessionId) ?? fallbackProjectKey : fallbackProjectKey
      if (projectKey) db.run(`UPDATE ${table} SET project_key = ? WHERE id = ?`, [projectKey, String(row.id)])
    }
  }
}

function backfillUnownedRows(db: Database, fallbackProjectKey?: string): void {
  if (!fallbackProjectKey) return
  const unownedTables = ['memory_records', 'context_diagnostics'] as const
  for (const table of unownedTables) {
    db.run(`UPDATE ${table} SET project_key = ? WHERE project_key IS NULL OR project_key = ''`, [fallbackProjectKey])
  }
}

function backfillFactProvenanceRows(db: Database, fallbackProjectKey: string): void {
  for (const row of selectDbRows(db, 'SELECT id, project_key, session_id, origin_json FROM context_facts WHERE origin_json IS NULL OR origin_json = ?', [''])) {
    const id = String(row.id)
    const projectKey = stringOrUndefined(row.project_key) ?? fallbackProjectKey
    const sessionId = stringOrUndefined(row.session_id)
    const origin: ContextOrigin = {
      projectKey,
      actor: 'main_session',
      ...(sessionId ? { sessionId } : {}),
    }
    db.run('UPDATE context_facts SET origin_json = ? WHERE id = ?', [JSON.stringify(origin), id])
  }
}

function backfillFactLifecycleRows(db: Database): void {
  db.run("UPDATE context_facts SET status = 'active' WHERE status IS NULL OR status = ''")
  db.run("UPDATE context_facts SET status = 'stale' WHERE freshness = 'stale' AND status = 'active'")
}

function selectDbRows(db: Database, sql: string, params: SqlValue[] = []): Array<Record<string, unknown>> {
  const stmt = db.prepare(sql)
  try {
    if (params.length) stmt.bind(params)
    const rows: Array<Record<string, unknown>> = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    return rows
  } finally {
    stmt.free()
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function ensureColumn(db: Database, table: string, column: string, definition: string): void {
  const columns = db.exec(`PRAGMA table_info(${table})`)[0]?.values.map((row) => String(row[1])) ?? []
  if (!columns.includes(column)) db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

function applyStatements(db: Database, statements: string[]): void {
  for (const statement of statements) db.run(statement)
}

function readSchemaVersion(db: Database): number | null {
  const hasMeta = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'")
  if (!hasMeta[0]?.values.length) return null

  const stmt = db.prepare('SELECT value FROM schema_meta WHERE key = ?')
  try {
    stmt.bind([CONTEXT_SCHEMA_VERSION_KEY])
    if (!stmt.step()) return null
    const value = stmt.getAsObject().value
    const parsed = Number(value)
    return Number.isInteger(parsed) ? parsed : null
  } finally {
    stmt.free()
  }
}

class SqlJsContextStore implements ContextStore {
  private dirty = false
  private batchDepth = 0

  constructor(
    private readonly db: Database,
    private readonly dbPath: string,
    private readonly projectKey: string,
    private readonly now: () => number,
    private readonly quotas: ContextStoreQuotas,
    private readonly backupPath?: string
  ) {}

  async saveRawEvidence(evidence: RawEvidence): Promise<ContextStoreResult> {
    const redacted = redactForDurableStorage(evidence)
    const parsed = RawEvidenceSchema.safeParse(redacted.value)
    if (!parsed.success) return failure(undefined, this.invalidDiagnostic('saveRawEvidence', parsed.error.message))

    return this.write('saveRawEvidence', undefined, () => {
      this.db.run(
        `INSERT OR REPLACE INTO raw_evidence(id, project_key, evidence_id, session_id, cwd, source_provider, kind, content, metadata_json, captured_at, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scopedId(this.projectKey, parsed.data.id),
          this.projectKey,
          parsed.data.id,
          parsed.data.sessionId,
          normalizeProjectRoot(parsed.data.cwd),
          parsed.data.sourceProvider,
          parsed.data.kind,
          parsed.data.content,
          JSON.stringify(parsed.data.metadata),
          parsed.data.capturedAt,
          parsed.data.hash,
        ]
      )
    }, { flush: false })
  }

  async saveFact(fact: ContextFact): Promise<ContextStoreResult> {
    const redacted = redactForDurableStorage(fact)
    const parsed = ContextFactSchema.safeParse(redacted.value)
    if (!parsed.success) {
      await this.rejectCandidate(redacted.value, parsed.error.message, { validationErrors: [parsed.error.message] })
      return failure(undefined, this.invalidDiagnostic('saveFact', parsed.error.message))
    }

    const acceptance = rejectUnsafeDurableFact(parsed.data, { citationSources: this.citationSourcesFromStoredEvidence() })
    if (!acceptance.accepted) {
      const reason = acceptance.errors.join('; ')
      await this.rejectCandidate(parsed.data, reason, { validationErrors: acceptance.errors })
      return failure(undefined, this.invalidDiagnostic('saveFact', reason))
    }

    return this.write('saveFact', undefined, () => {
      const resolution = this.resolveFactLifecycle(parsed.data)

      if (resolution.action === 'merge') {
        this.writeFactRow(resolution.fact, resolution.targetScopedId)
        return
      }

      for (const superseded of resolution.superseded) {
        this.db.run(
          `UPDATE context_facts
           SET status = ?, lifecycle_reason = ?, updated_at = ?
           WHERE project_key = ? AND fact_id = ?`,
          ['superseded', `superseded by ${resolution.fact.id}`, this.now(), this.projectKey, superseded.id]
        )
      }
      this.writeFactRow(resolution.fact)
    })
  }

  async rejectCandidate(candidate: unknown, reason: string, options: RejectCandidateOptions = {}): Promise<ContextStoreResult<RejectedCandidateRecord | null>> {
    const createdAt = options.createdAt ?? this.now()
    const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000
    const isPendingReview = (options.status ?? 'rejected') === 'pending_review'
    const record: RejectedCandidateRecord = {
      id: options.id ?? `rejected_${createdAt}_${Math.random().toString(36).slice(2)}`,
      sessionId: options.sessionId ?? 'unknown',
      status: options.status ?? 'rejected',
      candidate: isPendingReview ? candidate : redactRejectedCandidate(candidate),
      rejectionReason: sanitizeStoreText(reason),
      validationErrors: options.validationErrors?.map(sanitizeStoreText) ?? [],
      createdAt,
      expiresAt: createdAt + ttlMs,
      visibleInPrimaryUi: options.visibleInPrimaryUi ?? true,
    }

    return this.write('rejectCandidate', record, () => {
      this.db.run(
        `INSERT OR REPLACE INTO rejected_candidates(id, project_key, candidate_id, session_id, status, candidate_json, rejection_reason, validation_errors_json, created_at, expires_at, visible_in_primary_ui)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scopedId(this.projectKey, record.id),
          this.projectKey,
          record.id,
          record.sessionId,
          record.status,
          JSON.stringify(record.candidate),
          record.rejectionReason,
          JSON.stringify(record.validationErrors),
          record.createdAt,
          record.expiresAt,
          record.visibleInPrimaryUi ? 1 : 0,
        ]
      )
    })
  }

  async saveHarvestJob(job: HarvestJob): Promise<ContextStoreResult> {
    return this.writeHarvestJob('saveHarvestJob', job)
  }

  async updateHarvestJob(job: HarvestJob): Promise<ContextStoreResult> {
    return this.writeHarvestJob('updateHarvestJob', job)
  }

  async listHarvestJobs(sessionId?: string): Promise<ContextStoreResult<HarvestJob[]>> {
    return this.read('listHarvestJobs', [], () => {
      const rows = sessionId
        ? this.selectRows('SELECT * FROM harvest_jobs WHERE project_key = ? AND session_id = ? ORDER BY created_at ASC', [this.projectKey, sessionId])
        : this.selectRows('SELECT * FROM harvest_jobs WHERE project_key = ? ORDER BY created_at ASC', [this.projectKey])
      return rows.map(parseHarvestJobRow)
    })
  }

  async saveBundleSnapshot(bundle: ContextBundle): Promise<ContextStoreResult> {
    const parsed = ContextBundleSchema.safeParse(bundle)
    if (!parsed.success) return failure(undefined, this.invalidDiagnostic('saveBundleSnapshot', parsed.error.message))

    return this.write('saveBundleSnapshot', undefined, () => {
      this.db.run(
        `INSERT OR REPLACE INTO context_bundles(id, project_key, bundle_id, session_id, request_hash, bundle_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [scopedId(this.projectKey, parsed.data.id), this.projectKey, parsed.data.id, parsed.data.sessionId, parsed.data.requestHash, JSON.stringify(parsed.data), parsed.data.createdAt]
      )
    })
  }

  async saveDiagnostic(diagnostic: ContextDiagnostic): Promise<ContextStoreResult> {
    const parsed = ContextDiagnosticSchema.safeParse(diagnostic)
    if (!parsed.success) return failure(undefined, this.invalidDiagnostic('saveDiagnostic', parsed.error.message))

    return this.write('saveDiagnostic', undefined, () => {
      this.db.run(
        `INSERT OR REPLACE INTO context_diagnostics(id, project_key, diagnostic_id, level, source, message, citation_json, created_at, visible_in_primary_ui)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scopedId(this.projectKey, parsed.data.id),
          this.projectKey,
          parsed.data.id,
          parsed.data.level,
          parsed.data.source,
          sanitizeStoreText(parsed.data.message),
          parsed.data.citation ? JSON.stringify(parsed.data.citation) : null,
          parsed.data.createdAt,
          parsed.data.visibleInPrimaryUi === false ? 0 : 1,
        ]
      )
    })
  }

  async queryFacts(query: ContextFactQuery = {}): Promise<ContextStoreResult<ContextFact[]>> {
    return this.read('queryFacts', [], () => this.selectFacts(query))
  }

  async listAcceptedProjectFacts(query: Omit<ContextFactQuery, 'scope'> = {}): Promise<ContextStoreResult<ContextFact[]>> {
    return this.read('listAcceptedProjectFacts', [], () => this.selectFacts(query, ['project', 'repo', 'global'], 'updated_at DESC'))
  }

  async listAdvancedDiagnostics(options: ListAdvancedDiagnosticsOptions = {}): Promise<ContextStoreResult<ContextAdvancedDiagnostics>> {
    return this.read('listAdvancedDiagnostics', emptyAdvancedDiagnostics(), () => {
      const rejected = this.selectRejectedCandidatesForDiagnostics(options)
      const diagnostics = this.selectDiagnosticsForDiagnostics(options)
      const harvestJobs = this.selectHarvestJobsForDiagnostics(options)

      return {
        rejected: limitLatest(rejected, options.limit),
        diagnostics: limitLatest(diagnostics, options.limit),
        harvestJobs: limitLatest(harvestJobs, options.limit),
      }
    })
  }

  async invalidateByFileHash(filePath: string, currentHash: string): Promise<ContextStoreResult<{ invalidatedFacts: number }>> {
    return this.write('invalidateByFileHash', { invalidatedFacts: 0 }, () => {
      const normalizedFilePath = normalizeFileCitationRef(filePath, this.projectKey)
      const facts = this.selectRows('SELECT * FROM context_facts WHERE project_key = ?', [this.projectKey]).map((row) => parseFactRow(row))
      // Called only when a file's content has actually changed. A fact citing
      // this file is stale unless we can prove its cited hash still matches the
      // new content; a hashless file citation can't be proven fresh, so it is
      // conservatively marked stale rather than left as trustworthy.
      const invalidated = facts.filter((fact) =>
        fact.freshness !== 'stale' &&
        fact.citations.some((citation) =>
          citation.type === 'file' &&
          normalizeFileCitationRef(citation.ref, this.projectKey) === normalizedFilePath &&
          citation.hash !== currentHash,
        ),
      )
      for (const fact of invalidated) {
        this.db.run(
          `UPDATE context_facts
           SET freshness = ?,
             status = CASE WHEN status IN ('superseded', 'conflicted', 'archived') THEN status ELSE 'stale' END,
             updated_at = ?
           WHERE project_key = ? AND fact_id = ?`,
          ['stale', this.now(), this.projectKey, fact.id]
        )
      }
      return { invalidatedFacts: invalidated.length }
    })
  }

  async enforceQuotas(): Promise<ContextStoreResult<QuotaEnforcementResult>> {
    return this.write('enforceQuotas', emptyQuotaResult(), () => {
      const deletedRawEvidence = this.deleteIds(this.selectExpiredRawEvidenceIds())
      const deletedBundles = this.deleteIds(this.selectOverflowIds('context_bundles', this.quotas.maxBundleSnapshots, 'created_at DESC', 'created_at ASC'))
      const expiredRejected = this.deleteIds({
        table: 'rejected_candidates',
        ids: this.selectIds('SELECT id FROM rejected_candidates WHERE project_key = ? AND expires_at <= ? ORDER BY expires_at ASC', [this.projectKey, this.now()]),
      })
      const overflowRejected = this.deleteIds(this.selectOverflowIds('rejected_candidates', this.quotas.maxRejectedCandidates, 'created_at DESC', 'created_at ASC'))
      const deletedFacts = this.deleteIds(this.selectOverflowFactIds(), 'context_facts')
      const repairedHarvestJobs = this.repairStaleHarvestJobs()
      const result: QuotaEnforcementResult = {
        deletedFacts,
        deletedBundles,
        deletedRawEvidence,
        deletedRejectedCandidates: expiredRejected + overflowRejected,
      }
      if (repairedHarvestJobs > 0) result.repairedHarvestJobs = repairedHarvestJobs
      return result
    })
  }

  async getSchemaInfo(): Promise<ContextStoreResult<ContextStoreSchemaInfo>> {
    return this.read('getSchemaInfo', { version: CONTEXT_STORE_SCHEMA_VERSION, dbPath: this.dbPath, backupPath: this.backupPath }, () => ({
      version: readSchemaVersion(this.db) ?? CONTEXT_STORE_SCHEMA_VERSION,
      dbPath: this.dbPath,
      backupPath: this.backupPath,
    }))
  }

  async listBundleSnapshots(sessionId?: string): Promise<ContextStoreResult<ContextBundle[]>> {
    return this.read('listBundleSnapshots', [], () => {
      const rows = sessionId
        ? this.selectRows('SELECT bundle_json FROM context_bundles WHERE project_key = ? AND session_id = ? ORDER BY created_at ASC', [this.projectKey, sessionId])
        : this.selectRows('SELECT bundle_json FROM context_bundles WHERE project_key = ? ORDER BY created_at ASC', [this.projectKey])
      return rows.map((row) => ContextBundleSchema.parse(JSON.parse(String(row.bundle_json))))
    })
  }

  async listRawEvidence(sessionId?: string): Promise<ContextStoreResult<RawEvidence[]>> {
    return this.read('listRawEvidence', [], () => {
      const rows = sessionId
        ? this.selectRows('SELECT * FROM raw_evidence WHERE project_key = ? AND session_id = ? ORDER BY captured_at ASC', [this.projectKey, sessionId])
        : this.selectRows('SELECT * FROM raw_evidence WHERE project_key = ? ORDER BY captured_at ASC', [this.projectKey])
      return rows.map(parseRawEvidenceRow)
    })
  }

  async listRejectedCandidates(options: ListRejectedCandidatesOptions = {}): Promise<ContextStoreResult<RejectedCandidateRecord[]>> {
    return this.read('listRejectedCandidates', [], () => {
      const conditions: string[] = ['project_key = ?']
      const params: SqlValue[] = [this.projectKey]
      if (options.sessionId) {
        conditions.push('session_id = ?')
        params.push(options.sessionId)
      }
      if (!options.includeExpired) {
        conditions.push('expires_at > ?')
        params.push(this.now())
      }
      conditions.push("status != 'accepted'")
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
      return this.selectRows(`SELECT * FROM rejected_candidates ${where} ORDER BY created_at ASC`, params).map(parseRejectedCandidateRow)
    })
  }

  async approvePendingCandidate(id: string): Promise<ContextStoreResult<ContextFact | null>> {
    try {
      const rows = this.selectPendingCandidateRows(id)
      if (!rows.length) {
        return { ok: false, diagnostics: [makeDiagnostic('Pending candidate not found', 'error')], value: null }
      }
      const record = parseRejectedCandidateRow(rows[0])
      const parsedEnvelope = DistillerEnvelopeSchema.safeParse(record.candidate)
      if (!parsedEnvelope.success) {
        return { ok: false, diagnostics: [makeDiagnostic(`Candidate is not a valid distiller envelope: ${parsedEnvelope.error.message}`, 'error')], value: null }
      }
      const envelope = parsedEnvelope.data
      const validatedEnvelope = validateDistillerOutput(envelope, { citationSources: this.citationSourcesFromStoredEvidence() })
      if (!validatedEnvelope.accepted) {
        return { ok: false, diagnostics: [makeDiagnostic(`Candidate distiller envelope rejected: ${validatedEnvelope.errors.join('; ')}`, 'error')], value: null }
      }
      const now = this.now()
      const fact: ContextFact = {
        id: `approved_${id}`,
        kind: kindFromEnvelope(envelope as any),
        scope: scopeFromEnvelope(envelope as any),
        content: contentFromEnvelope(envelope as any),
        citations: envelope.citations,
        confidence: confidenceFromEnvelope(envelope as any),
        freshness: 'recent',
        sourceProvider: envelope.distiller,
        sessionId: record.sessionId || undefined,
        createdAt: record.createdAt,
        updatedAt: now,
      }
      const saved = await this.saveFact(fact)
      if (!saved.ok) {
        return { ok: false, diagnostics: saved.diagnostics, value: null }
      }

      return this.write('approvePendingCandidate', undefined, () => {
        this.updatePendingCandidateStatus(id, 'accepted')
      }).then(() => success(fact))
    } catch (error) {
      return failure(null, createStoreDiagnostic(error, 'Context store approvePendingCandidate failed'))
    }
  }

  async rejectPendingCandidate(id: string): Promise<ContextStoreResult<RejectedCandidateRecord | null>> {
    try {
      const rows = this.selectPendingCandidateRows(id)
      if (!rows.length) {
        return { ok: false, diagnostics: [makeDiagnostic('Pending candidate not found', 'error')], value: null }
      }
      return this.write('rejectPendingCandidate', undefined, () => {
        this.updatePendingCandidateStatus(id, 'rejected')
      }).then(() => {
        const updated = parseRejectedCandidateRow(this.selectRows('SELECT * FROM rejected_candidates WHERE project_key = ? AND (id = ? OR id = ? OR candidate_id = ?)', [this.projectKey, id, scopedId(this.projectKey, id), id])[0])
        return success(updated)
      })
    } catch (error) {
      return failure(null, createStoreDiagnostic(error, 'Context store rejectPendingCandidate failed'))
    }
  }

  async listDiagnostics(): Promise<ContextStoreResult<ContextDiagnostic[]>> {
    return this.read('listDiagnostics', [], () => this.selectRows('SELECT * FROM context_diagnostics WHERE project_key = ? ORDER BY created_at ASC', [this.projectKey]).map(parseDiagnosticRow))
  }

  async withWriteBatch<T>(operation: string, fn: () => Promise<T> | T): Promise<ContextStoreResult<T>> {
    this.batchDepth += 1
    try {
      const value = await fn()
      this.batchDepth = Math.max(0, this.batchDepth - 1)
      if (this.batchDepth === 0) this.flushIfDirty()
      return success(value)
    } catch (error) {
      this.batchDepth = Math.max(0, this.batchDepth - 1)
      return failure(undefined as T, createStoreDiagnostic(error, `Context store ${operation} batch failed`))
    }
  }

  persist(): void {
    writeFileSync(this.dbPath, Buffer.from(this.db.export()))
    this.dirty = false
  }

  private markDirty(): void {
    this.dirty = true
  }

  private flushIfDirty(): void {
    if (this.dirty) this.persist()
  }

  private read<T>(operation: string, fallback: T, readFn: () => T): Promise<ContextStoreResult<T>> {
    try {
      return Promise.resolve(success(readFn()))
    } catch (error) {
      return Promise.resolve(failure(fallback, createStoreDiagnostic(error, `Context store ${operation} failed`)))
    }
  }

  private write<T>(operation: string, value: T, writeFn: () => T | void, options: { flush?: boolean } = { flush: true }): Promise<ContextStoreResult<T>> {
    try {
      const writtenValue = writeFn()
      this.markDirty()
      if (options.flush && this.batchDepth === 0) this.flushIfDirty()
      return Promise.resolve(success((writtenValue ?? value) as T))
    } catch (error) {
      return Promise.resolve(failure(value, createStoreDiagnostic(error, `Context store ${operation} failed`)))
    }
  }

  private invalidDiagnostic(operation: string, message: string): ContextDiagnostic {
    return makeDiagnostic(`Context store ${operation} rejected invalid input: ${sanitizeStoreText(message)}`, 'warning')
  }

  private selectRows(sql: string, params: SqlValue[] = []): Array<Record<string, unknown>> {
    const stmt = this.db.prepare(sql)
    try {
      if (params.length) stmt.bind(params)
      const rows: Array<Record<string, unknown>> = []
      while (stmt.step()) rows.push(stmt.getAsObject())
      return rows
    } finally {
      stmt.free()
    }
  }

  private selectPendingCandidateRows(id: string): Array<Record<string, unknown>> {
    return this.selectRows(
      'SELECT * FROM rejected_candidates WHERE project_key = ? AND (id = ? OR id = ? OR candidate_id = ?) AND status = ?',
      [this.projectKey, id, scopedId(this.projectKey, id), id, 'pending_review']
    )
  }

  private selectFacts(query: ContextFactQuery | Omit<ContextFactQuery, 'scope'>, acceptedScopes?: ContextScope[], orderBy = 'updated_at ASC'): ContextFact[] {
    const conditions = ['project_key = ?']
    const params: SqlValue[] = [this.projectKey]
    const scopedQuery = query as ContextFactQuery

    if (acceptedScopes?.length) {
      conditions.push(`scope IN (${acceptedScopes.map(() => '?').join(', ')})`)
      params.push(...acceptedScopes)
    } else if (scopedQuery.scope) {
      conditions.push('scope = ?')
      params.push(scopedQuery.scope)
    }
    if (query.kinds?.length) {
      conditions.push(`kind IN (${query.kinds.map(() => '?').join(', ')})`)
      params.push(...query.kinds)
    }
    if (query.freshness) {
      conditions.push('freshness = ?')
      params.push(query.freshness)
    } else if (!query.includeStale) {
      conditions.push("freshness != 'stale'")
    }
    if (query.status) {
      conditions.push('status = ?')
      params.push(query.status)
    } else if (!query.includeInactive) {
      conditions.push("status NOT IN ('superseded', 'conflicted', 'archived')")
    }
    if (query.minConfidence !== undefined) {
      conditions.push('confidence >= ?')
      params.push(query.minConfidence)
    }
    if (!query.includeExpired) {
      conditions.push('(expires_at IS NULL OR expires_at > ?)')
      params.push(this.now())
    }

    const limit = normalizedLimit(query.limit)
    const deferLimitUntilAfterCitationFilter = limit !== undefined && Boolean(query.citationRef || query.citationType)
    const limitClause = limit === undefined || deferLimitUntilAfterCitationFilter ? '' : ' LIMIT ?'
    if (limit !== undefined && !deferLimitUntilAfterCitationFilter) params.push(limit)

    const rows = this.selectRows(`SELECT * FROM context_facts WHERE ${conditions.join(' AND ')} ORDER BY ${orderByFromQuery(query.orderBy) ?? orderBy}${limitClause}`, params)
    const facts = rows.map((row) => parseFactRow(row)).filter((fact) => matchesCitationQuery(fact, query))
    return limit !== undefined && deferLimitUntilAfterCitationFilter ? facts.slice(0, limit) : facts
  }

  private resolveFactLifecycle(fact: ContextFact): FactLifecycleResolution {
    const incoming = this.withLifecycleDefaults(fact)
    const explicitCanonicalKey = typeof fact.canonicalKey === 'string' && fact.canonicalKey.trim().length > 0
    const candidates = explicitCanonicalKey ? this.selectLifecycleCandidates(incoming.canonicalKey) : []
    const duplicate = candidates.find((candidate) => normalizeFactLifecycleContent(candidate.fact.content) === normalizeFactLifecycleContent(incoming.content))

    if (duplicate) {
      return {
        action: 'merge',
        targetScopedId: duplicate.scopedId,
        superseded: [],
        fact: this.mergeDuplicateFacts(duplicate.fact, incoming),
      }
    }

    const superseded = explicitCanonicalKey && incoming.status === 'active'
      ? candidates.map((candidate) => candidate.fact).filter((candidate) => factStatus(candidate) === 'active' || factStatus(candidate) === 'stale')
      : []
    const supersedes = mergeStringLists(incoming.supersedes, superseded.map((candidate) => candidate.id))
    const lifecycleReason = superseded.length > 0 && !incoming.lifecycleReason
      ? `supersedes ${superseded.map((candidate) => candidate.id).join(', ')}`
      : incoming.lifecycleReason

    return {
      action: 'insert',
      superseded,
      fact: {
        ...incoming,
        supersedes,
        ...(lifecycleReason ? { lifecycleReason } : {}),
      },
    }
  }

  private withLifecycleDefaults(fact: ContextFact): LifecycleFact {
    const status = fact.status ?? (fact.freshness === 'stale' ? 'stale' : 'active')
    return {
      ...fact,
      status,
      canonicalKey: normalizeCanonicalKey(fact.canonicalKey) ?? canonicalKeyForFact(fact),
      supersedes: fact.supersedes ?? [],
      conflictsWith: fact.conflictsWith ?? [],
    }
  }

  private selectLifecycleCandidates(canonicalKey: string): StoredLifecycleFact[] {
    if (!canonicalKey) return []
    return this.selectRows(
      `SELECT * FROM context_facts
       WHERE project_key = ?
         AND canonical_key = ?
         AND status NOT IN ('superseded', 'conflicted', 'archived')
       ORDER BY updated_at DESC`,
      [this.projectKey, canonicalKey]
    ).map((row) => ({ scopedId: String(row.id), fact: parseFactRow(row) }))
  }

  private mergeDuplicateFacts(existing: ContextFact, incoming: LifecycleFact): LifecycleFact {
    const existingLifecycle = this.withLifecycleDefaults(existing)
    return {
      ...existingLifecycle,
      citations: mergeCitations(existingLifecycle.citations, incoming.citations),
      confidence: Math.max(existingLifecycle.confidence, incoming.confidence),
      freshness: freshestFreshness(existingLifecycle.freshness, incoming.freshness),
      sourceProvider: mergeSourceProviders(existingLifecycle.sourceProvider, incoming.sourceProvider),
      updatedAt: Math.max(existingLifecycle.updatedAt, incoming.updatedAt),
      expiresAt: laterTimestamp(existingLifecycle.expiresAt, incoming.expiresAt),
      tags: mergeOptionalStringLists(existingLifecycle.tags, incoming.tags),
      relatedFiles: mergeOptionalStringLists(existingLifecycle.relatedFiles, incoming.relatedFiles),
      relatedSymbols: mergeOptionalStringLists(existingLifecycle.relatedSymbols, incoming.relatedSymbols),
      relatedTasks: mergeOptionalStringLists(existingLifecycle.relatedTasks, incoming.relatedTasks),
      supersedes: mergeStringLists(existingLifecycle.supersedes, incoming.supersedes),
      conflictsWith: mergeStringLists(existingLifecycle.conflictsWith, incoming.conflictsWith),
      lifecycleReason: incoming.lifecycleReason ?? existingLifecycle.lifecycleReason,
    }
  }

  private writeFactRow(fact: ContextFact, rowId = scopedId(this.projectKey, fact.id)): void {
    const lifecycleFact = this.withLifecycleDefaults(fact)
    const origin = lifecycleFact.origin ?? defaultOriginForFact(lifecycleFact, this.projectKey)
    const tags = lifecycleFact.tags ?? []
    const relatedFiles = lifecycleFact.relatedFiles ?? []
    const relatedSymbols = lifecycleFact.relatedSymbols ?? []
    const relatedTasks = lifecycleFact.relatedTasks ?? []
    this.db.run(
      `INSERT OR REPLACE INTO context_facts(id, project_key, fact_id, kind, scope, content, citations_json, confidence, freshness, source_provider, session_id, created_at, updated_at, expires_at, origin_json, tags_json, related_files_json, related_symbols_json, related_tasks_json, status, canonical_key, supersedes_json, conflicts_with_json, archived_at, lifecycle_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rowId,
        this.projectKey,
        lifecycleFact.id,
        lifecycleFact.kind,
        lifecycleFact.scope,
        lifecycleFact.content,
        JSON.stringify(lifecycleFact.citations),
        lifecycleFact.confidence,
        lifecycleFact.freshness,
        lifecycleFact.sourceProvider,
        lifecycleFact.sessionId ?? null,
        lifecycleFact.createdAt,
        lifecycleFact.updatedAt,
        lifecycleFact.expiresAt ?? null,
        JSON.stringify(origin),
        JSON.stringify(tags),
        JSON.stringify(relatedFiles),
        JSON.stringify(relatedSymbols),
        JSON.stringify(relatedTasks),
        lifecycleFact.status,
        lifecycleFact.canonicalKey,
        JSON.stringify(lifecycleFact.supersedes),
        JSON.stringify(lifecycleFact.conflictsWith),
        lifecycleFact.archivedAt ?? null,
        lifecycleFact.lifecycleReason ?? null,
      ]
    )
  }

  private selectRejectedCandidatesForDiagnostics(options: ListAdvancedDiagnosticsOptions): RejectedCandidateRecord[] {
    const conditions: string[] = ['project_key = ?', "status != 'accepted'", 'expires_at > ?']
    const params: SqlValue[] = [this.projectKey, this.now()]
    if (options.sessionId) {
      conditions.push('session_id = ?')
      params.push(options.sessionId)
    }
    const rows = this.selectRows(`SELECT * FROM rejected_candidates WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC`, params)
    return rows.map(parseRejectedCandidateRow).filter((candidate) => options.includeNoop || !isModelNoopRejectedCandidate(candidate))
  }

  private selectDiagnosticsForDiagnostics(options: ListAdvancedDiagnosticsOptions): ContextDiagnostic[] {
    const rows = this.selectRows('SELECT * FROM context_diagnostics WHERE project_key = ? ORDER BY created_at ASC', [this.projectKey])
    return rows.map(parseDiagnosticRow).filter((diagnostic) => options.includeNoop || !isModelNoopDiagnostic(diagnostic))
  }

  private selectHarvestJobsForDiagnostics(options: ListAdvancedDiagnosticsOptions): HarvestJob[] {
    const conditions: string[] = ['project_key = ?', "status IN ('skipped', 'rejected', 'failed')"]
    const params: SqlValue[] = [this.projectKey]
    if (options.sessionId) {
      conditions.push('session_id = ?')
      params.push(options.sessionId)
    }
    const rows = this.selectRows(`SELECT * FROM harvest_jobs WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC`, params)
    return rows.map(parseHarvestJobRow).filter((job) => options.includeNoop || !isModelNoopHarvestJob(job))
  }

  private updatePendingCandidateStatus(id: string, status: 'accepted' | 'rejected'): void {
    this.db.run(
      'UPDATE rejected_candidates SET status = ? WHERE project_key = ? AND (id = ? OR id = ? OR candidate_id = ?) AND status = ?',
      [status, this.projectKey, id, scopedId(this.projectKey, id), id, 'pending_review']
    )
  }

  private selectIds(sql: string, params: SqlValue[] = []): string[] {
    return this.selectRows(sql, params).map((row) => String(row.id))
  }

  private selectExpiredRawEvidenceIds(): { table: string; ids: string[] } {
    return {
      table: 'raw_evidence',
      ids: this.selectIds('SELECT id FROM raw_evidence WHERE project_key = ? AND captured_at < ? ORDER BY captured_at ASC', [this.projectKey, this.now() - this.quotas.rawEvidenceTtlMs]),
    }
  }

  private selectOverflowIds(table: string, limit: number, keepOrder: string, deleteOrder: string): { table: string; ids: string[] } {
    if (limit < 0) return { table, ids: [] }
    const keepIds = new Set(this.selectIds(`SELECT id FROM ${table} WHERE project_key = ? ORDER BY ${keepOrder} LIMIT ?`, [this.projectKey, limit]))
    const ids = this.selectIds(`SELECT id FROM ${table} WHERE project_key = ? ORDER BY ${deleteOrder}`, [this.projectKey]).filter((id) => !keepIds.has(id))
    return { table, ids }
  }

  private selectOverflowFactIds(): { table: string; ids: string[] } {
    if (!Number.isFinite(this.quotas.maxFacts)) return { table: 'context_facts', ids: [] }
    const count = Number(this.selectRows('SELECT COUNT(*) AS count FROM context_facts WHERE project_key = ?', [this.projectKey])[0]?.count ?? 0)
    const overflow = count - this.quotas.maxFacts
    if (overflow <= 0) return { table: 'context_facts', ids: [] }
    return {
      table: 'context_facts',
      ids: this.selectIds(
        `SELECT id FROM context_facts
         WHERE project_key = ?
         ORDER BY confidence ASC,
           CASE freshness WHEN 'stale' THEN 0 WHEN 'cached' THEN 1 WHEN 'recent' THEN 2 WHEN 'live' THEN 3 ELSE 4 END ASC,
           updated_at ASC
         LIMIT ?`,
        [this.projectKey, overflow]
      ),
    }
  }

  private writeHarvestJob(operation: string, job: HarvestJob): Promise<ContextStoreResult> {
    const redacted = redactForDurableStorage(job)
    const parsed = HarvestJobSchema.safeParse(redacted.value)
    if (!parsed.success) return Promise.resolve(failure(undefined, this.invalidDiagnostic(operation, parsed.error.message)))

    return this.write(operation, undefined, () => {
      this.db.run(
        `INSERT OR REPLACE INTO harvest_jobs(id, project_key, job_id, session_id, run_loop_id, status, candidate_json, decision_json, model_binding_json, created_at, updated_at, visible_in_primary_ui)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scopedId(this.projectKey, parsed.data.id),
          this.projectKey,
          parsed.data.id,
          parsed.data.sessionId,
          parsed.data.runLoopId,
          parsed.data.status,
          JSON.stringify(parsed.data.candidate),
          parsed.data.decision ? JSON.stringify(parsed.data.decision) : null,
          JSON.stringify(parsed.data.modelBinding),
          parsed.data.createdAt,
          parsed.data.updatedAt,
          parsed.data.visibleInPrimaryUi === false ? 0 : 1,
        ]
      )
    })
  }

  private repairStaleHarvestJobs(): number {
    if (this.quotas.staleHarvestJobTtlMs < 0) return 0
    const cutoff = this.now() - this.quotas.staleHarvestJobTtlMs
    const rows = this.selectRows(
      `SELECT * FROM harvest_jobs
       WHERE project_key = ?
         AND status IN ('queued', 'classified', 'distilling', 'validating')
         AND updated_at < ?
       ORDER BY updated_at ASC`,
      [this.projectKey, cutoff]
    )
    for (const row of rows) {
      const job = parseHarvestJobRow(row)
      const repaired = {
        ...job,
        status: 'skipped' as const,
        decision: { action: 'skip' as const, reason: 'timeout' as const },
        updatedAt: this.now(),
        visibleInPrimaryUi: false,
      }
      this.db.run(
        `UPDATE harvest_jobs
         SET status = ?, decision_json = ?, updated_at = ?, visible_in_primary_ui = ?
         WHERE project_key = ? AND job_id = ?`,
        [repaired.status, JSON.stringify(repaired.decision), repaired.updatedAt, 0, this.projectKey, repaired.id]
      )
      this.writeDiagnosticRow({
        ...makeDiagnostic(`Repaired stale harvest job ${job.id} from ${job.status} to skipped timeout`, 'warning'),
        visibleInPrimaryUi: false,
      })
    }
    return rows.length
  }

  private writeDiagnosticRow(diagnostic: ContextDiagnostic): void {
    this.db.run(
      `INSERT OR REPLACE INTO context_diagnostics(id, project_key, diagnostic_id, level, source, message, citation_json, created_at, visible_in_primary_ui)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scopedId(this.projectKey, diagnostic.id),
        this.projectKey,
        diagnostic.id,
        diagnostic.level,
        diagnostic.source,
        sanitizeStoreText(diagnostic.message),
        diagnostic.citation ? JSON.stringify(diagnostic.citation) : null,
        diagnostic.createdAt,
        diagnostic.visibleInPrimaryUi === false ? 0 : 1,
      ]
    )
  }

  private citationSourcesFromStoredEvidence(): CitationValidationSources {
    const evidence = this.selectRows('SELECT * FROM raw_evidence WHERE project_key = ?', [this.projectKey]).map(parseRawEvidenceRow)
    const sources: CitationValidationSources = { cwd: this.projectKey }

    for (const item of evidence) addEvidenceToCitationSources(sources, item)
    return sources
  }

  private deleteIds(selection: { table: string; ids: string[] }, fallbackTable?: string): number {
    const table = selection.table || fallbackTable
    if (!table) return 0
    for (const id of selection.ids) this.db.run(`DELETE FROM ${table} WHERE id = ?`, [id])
    return selection.ids.length
  }
}

class UnavailableContextStore implements ContextStore {
  constructor(private readonly dbPath: string, private readonly diagnostic: ContextDiagnostic) {}

  async saveRawEvidence(): Promise<ContextStoreResult> { return this.unavailable(undefined) }
  async saveFact(): Promise<ContextStoreResult> { return this.unavailable(undefined) }
  async saveHarvestJob(): Promise<ContextStoreResult> { return this.unavailable(undefined) }
  async updateHarvestJob(): Promise<ContextStoreResult> { return this.unavailable(undefined) }
  async listHarvestJobs(): Promise<ContextStoreResult<HarvestJob[]>> { return this.unavailable([]) }
  async rejectCandidate(): Promise<ContextStoreResult<RejectedCandidateRecord | null>> { return this.unavailable(null) }
  async saveBundleSnapshot(): Promise<ContextStoreResult> { return this.unavailable(undefined) }
  async saveDiagnostic(): Promise<ContextStoreResult> { return this.unavailable(undefined) }
  async queryFacts(): Promise<ContextStoreResult<ContextFact[]>> { return this.unavailable([]) }
  async listAcceptedProjectFacts(): Promise<ContextStoreResult<ContextFact[]>> { return this.unavailable([]) }
  async listAdvancedDiagnostics(): Promise<ContextStoreResult<ContextAdvancedDiagnostics>> { return this.unavailable(emptyAdvancedDiagnostics()) }
  async invalidateByFileHash(): Promise<ContextStoreResult<{ invalidatedFacts: number }>> { return this.unavailable({ invalidatedFacts: 0 }) }
  async enforceQuotas(): Promise<ContextStoreResult<QuotaEnforcementResult>> { return this.unavailable(emptyQuotaResult()) }
  async getSchemaInfo(): Promise<ContextStoreResult<ContextStoreSchemaInfo>> { return this.unavailable({ version: CONTEXT_STORE_SCHEMA_VERSION, dbPath: this.dbPath }) }
  async listBundleSnapshots(): Promise<ContextStoreResult<ContextBundle[]>> { return this.unavailable([]) }
  async listRawEvidence(): Promise<ContextStoreResult<RawEvidence[]>> { return this.unavailable([]) }
  async listRejectedCandidates(): Promise<ContextStoreResult<RejectedCandidateRecord[]>> { return this.unavailable([]) }
  async approvePendingCandidate(): Promise<ContextStoreResult<ContextFact | null>> { return this.unavailable(null) }
  async rejectPendingCandidate(): Promise<ContextStoreResult<RejectedCandidateRecord | null>> { return this.unavailable(null) }
  async listDiagnostics(): Promise<ContextStoreResult<ContextDiagnostic[]>> { return this.unavailable([]) }
  async withWriteBatch<T>(): Promise<ContextStoreResult<T>> { return this.unavailable(undefined as T) }

  private unavailable<T>(value: T): ContextStoreResult<T> {
    return failure(value, this.diagnostic)
  }
}

function parseFactRow(row: Record<string, unknown>): ContextFact {
  const freshness = String(row.freshness) as ContextFreshness
  return ContextFactSchema.parse({
    id: row.fact_id ? String(row.fact_id) : String(row.id),
    kind: row.kind,
    scope: row.scope,
    content: row.content,
    citations: JSON.parse(String(row.citations_json)),
    confidence: Number(row.confidence),
    freshness,
    sourceProvider: row.source_provider,
    sessionId: row.session_id ? String(row.session_id) : undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    expiresAt: row.expires_at === null || row.expires_at === undefined ? undefined : Number(row.expires_at),
    origin: parseJsonColumn<ContextOrigin | undefined>(row.origin_json, undefined),
    tags: parseStringArrayColumn(row.tags_json),
    relatedFiles: parseStringArrayColumn(row.related_files_json),
    relatedSymbols: parseStringArrayColumn(row.related_symbols_json),
    relatedTasks: parseStringArrayColumn(row.related_tasks_json),
    status: parseFactStatusColumn(row.status, freshness),
    canonicalKey: stringOrUndefined(row.canonical_key),
    supersedes: parseStringArrayColumn(row.supersedes_json),
    conflictsWith: parseStringArrayColumn(row.conflicts_with_json),
    archivedAt: row.archived_at === null || row.archived_at === undefined ? undefined : Number(row.archived_at),
    lifecycleReason: stringOrUndefined(row.lifecycle_reason),
  })
}

function defaultOriginForFact(fact: ContextFact, projectKey: string): ContextOrigin {
  return {
    projectKey,
    actor: 'main_session',
    ...(fact.sessionId ? { sessionId: fact.sessionId } : {}),
  }
}

function parseFactStatusColumn(value: unknown, freshness: ContextFreshness): ContextFactStatus {
  if (value === 'active' || value === 'stale' || value === 'superseded' || value === 'conflicted' || value === 'archived') return value
  return freshness === 'stale' ? 'stale' : 'active'
}

function factStatus(fact: ContextFact): ContextFactStatus {
  return fact.status ?? (fact.freshness === 'stale' ? 'stale' : 'active')
}

function normalizeCanonicalKey(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : undefined
}

function canonicalKeyForFact(fact: ContextFact): string {
  const refs = [
    ...(fact.relatedFiles ?? []),
    ...fact.citations.filter((citation) => citation.type === 'file').map((citation) => citation.ref),
  ].map((ref) => ref.trim().toLowerCase()).filter(Boolean).sort()
  const contentKey = hashStoreText(normalizeFactLifecycleContent(fact.content)).slice(0, 24)
  return ['auto', fact.kind, fact.scope, refs.join(','), contentKey].filter(Boolean).join(':')
}

function normalizeFactLifecycleContent(content: string): string {
  return content.toLowerCase().replace(/\s+/g, ' ').trim()
}

function mergeCitations(existing: ContextCitation[], incoming: ContextCitation[]): ContextCitation[] {
  const seen = new Set<string>()
  const result: ContextCitation[] = []
  for (const citation of [...existing, ...incoming]) {
    const key = JSON.stringify([citation.id, citation.type, citation.ref, citation.hash ?? '', citation.line ?? '', citation.range ?? ''])
    if (seen.has(key)) continue
    seen.add(key)
    result.push(citation)
  }
  return result
}

function mergeStringLists(...lists: Array<string[] | undefined>): string[] {
  return [...new Set(lists.flatMap((list) => list ?? []).filter((value) => value.length > 0))]
}

function mergeOptionalStringLists(...lists: Array<string[] | undefined>): string[] | undefined {
  const merged = mergeStringLists(...lists)
  return merged.length ? merged : undefined
}

function freshestFreshness(a: ContextFreshness, b: ContextFreshness): ContextFreshness {
  const rank: Record<ContextFreshness, number> = { stale: 0, cached: 1, recent: 2, live: 3 }
  return rank[b] > rank[a] ? b : a
}

function mergeSourceProviders(a: string, b: string): string {
  return a === b ? a : mergeStringLists([a], [b]).join(', ')
}

function laterTimestamp(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.max(a, b)
}

function hashStoreText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

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

function parseRawEvidenceRow(row: Record<string, unknown>): RawEvidence {
  return RawEvidenceSchema.parse({
    id: row.evidence_id ? String(row.evidence_id) : String(row.id),
    sessionId: row.session_id,
    cwd: row.cwd,
    sourceProvider: row.source_provider,
    kind: row.kind,
    content: row.content,
    metadata: JSON.parse(String(row.metadata_json)),
    capturedAt: Number(row.captured_at),
    hash: row.hash,
  })
}

function parseHarvestJobRow(row: Record<string, unknown>): HarvestJob {
  const candidate = JSON.parse(String(row.candidate_json)) as HarvestJob['candidate']
  const modelBinding = JSON.parse(String(row.model_binding_json)) as HarvestJob['modelBinding']
  const decision = row.decision_json ? (JSON.parse(String(row.decision_json)) as HarvestJob['decision']) : undefined
  return HarvestJobSchema.parse({
    id: row.job_id ? String(row.job_id) : String(row.id),
    sessionId: row.session_id,
    runLoopId: row.run_loop_id,
    status: row.status,
    candidate,
    decision,
    modelBinding,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    visibleInPrimaryUi: visibleInPrimaryUiFromRow(row),
  }) as HarvestJob
}

function parseRejectedCandidateRow(row: Record<string, unknown>): RejectedCandidateRecord {
  const rawStatus = String(row.status ?? 'rejected')
  return {
    id: row.candidate_id ? String(row.candidate_id) : String(row.id),
    sessionId: String(row.session_id),
    status: (rawStatus === 'pending_review' || rawStatus === 'accepted') ? rawStatus as 'pending_review' | 'accepted' : 'rejected',
    candidate: JSON.parse(String(row.candidate_json)),
    rejectionReason: String(row.rejection_reason),
    validationErrors: JSON.parse(String(row.validation_errors_json)) as string[],
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    visibleInPrimaryUi: visibleInPrimaryUiFromRow(row),
  }
}

function parseDiagnosticRow(row: Record<string, unknown>): ContextDiagnostic {
  return ContextDiagnosticSchema.parse({
    id: row.diagnostic_id ? String(row.diagnostic_id) : String(row.id),
    level: row.level,
    source: row.source,
    message: row.message,
    citation: row.citation_json ? JSON.parse(String(row.citation_json)) : undefined,
    createdAt: Number(row.created_at),
    visibleInPrimaryUi: visibleInPrimaryUiFromRow(row),
  })
}

function visibleInPrimaryUiFromRow(row: Record<string, unknown>): boolean {
  return row.visible_in_primary_ui === undefined || row.visible_in_primary_ui === null ? true : Number(row.visible_in_primary_ui) !== 0
}

function matchesCitationQuery(fact: ContextFact, query: ContextFactQuery | Omit<ContextFactQuery, 'scope'>): boolean {
  if (!query.citationRef && !query.citationType) return true
  return fact.citations.some((citation) => {
    if (query.citationRef && citation.ref !== query.citationRef) return false
    if (query.citationType && citation.type !== query.citationType) return false
    return true
  })
}

function limitLatest<T extends { createdAt: number }>(items: T[], limit?: number): T[] {
  if (!limit || limit <= 0 || items.length <= limit) return items
  return items.slice(items.length - limit)
}

function normalizedLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined
  if (!Number.isFinite(limit)) return undefined
  const normalized = Math.floor(limit)
  return normalized > 0 ? normalized : undefined
}

function orderByFromQuery(orderBy: ContextFactQuery['orderBy']): string | undefined {
  switch (orderBy) {
    case 'updated_asc':
      return 'updated_at ASC'
    case 'updated_desc':
      return 'updated_at DESC'
    case 'created_asc':
      return 'created_at ASC'
    case 'created_desc':
      return 'created_at DESC'
    case 'confidence_desc':
      return 'confidence DESC, updated_at DESC'
    default:
      return undefined
  }
}

function isModelNoopRejectedCandidate(candidate: RejectedCandidateRecord): boolean {
  if (candidate.validationErrors.some(isModelNoopText)) return true
  if (isModelNoopText(candidate.rejectionReason)) return true
  return isModelNoopSkipCandidate(candidate.candidate)
}

function isModelNoopHarvestJob(job: HarvestJob): boolean {
  return job.decision?.action === 'skip' && job.decision.reason === 'model_noop'
}

function isModelNoopDiagnostic(diagnostic: ContextDiagnostic): boolean {
  return isModelNoopText(diagnostic.message)
}

function isModelNoopText(text: string): boolean {
  return /model_noop/i.test(text)
}

function isModelNoopSkipCandidate(candidate: unknown): boolean {
  if (!candidate || typeof candidate !== 'object') return false
  const record = candidate as Record<string, unknown>
  return record.action === 'skip' && record.reason === 'model_noop'
}

function addEvidenceToCitationSources(sources: CitationValidationSources, evidence: RawEvidence): void {
  for (const ref of citationRefsForEvidence(evidence)) {
    switch (evidence.kind) {
      case 'file':
        ;(sources.retainedFileSnapshots ??= []).push({ ref, hash: evidence.hash })
        break
      case 'message':
        ;(sources.messages ??= []).push({ id: ref })
        break
      case 'tool_event':
        ;(sources.toolEvents ??= []).push({ id: ref })
        break
      case 'git':
        ;(sources.gitEvidence ??= []).push({ id: evidence.id, ref, hash: evidence.hash })
        break
      case 'memory':
        ;(sources.memoryRecords ??= []).push({ id: ref })
        break
      case 'diagnostic':
        ;(sources.diagnostics ??= []).push({ id: ref })
        break
      case 'ide':
        ;(sources.ideEvidence ??= []).push({ id: evidence.id, ref })
        break
      case 'config':
        ;(sources.configEvidence ??= []).push({ id: evidence.id, ref })
        break
      case 'task':
        ;(sources.tasks ??= []).push({ id: evidence.id, ref })
        break
    }
  }
}

function citationRefsForEvidence(evidence: RawEvidence): string[] {
  const refs = new Set<string>([evidence.id])
  const metadata = evidence.metadata

  addStringRef(refs, metadata.file)
  addStringRef(refs, metadata.ref)
  addStringRef(refs, metadata.path)
  addStringRef(refs, metadata.messageId)
  addStringRef(refs, metadata.eventId)
  addStringRef(refs, metadata.id)

  if (Array.isArray(metadata.refs)) {
    for (const ref of metadata.refs) addStringRef(refs, ref)
  }

  return [...refs]
}

function addStringRef(refs: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value) refs.add(value)
}

function success<T>(value: T): ContextStoreResult<T> {
  return { ok: true, value, diagnostics: [] }
}

function failure<T>(value: T, diagnostic: ContextDiagnostic): ContextStoreResult<T> {
  return { ok: false, value, diagnostics: [diagnostic] }
}

function emptyQuotaResult(): QuotaEnforcementResult {
  return { deletedFacts: 0, deletedBundles: 0, deletedRawEvidence: 0, deletedRejectedCandidates: 0 }
}

function emptyAdvancedDiagnostics(): ContextAdvancedDiagnostics {
  return { rejected: [], diagnostics: [], harvestJobs: [] }
}

function createStoreDiagnostic(error: unknown, message: string): ContextDiagnostic {
  const suffix = error instanceof Error ? `: ${sanitizeStoreText(error.message)}` : ''
  return makeDiagnostic(`${message}${suffix}`, 'error')
}

function makeDiagnostic(message: string, level: ContextDiagnostic['level']): ContextDiagnostic {
  return {
    id: `diagnostic_context_store_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    level,
    source: 'ContextStore',
    message,
    createdAt: Date.now(),
  }
}

function redactRejectedCandidate(candidate: unknown): unknown {
  const redacted = redactForDurableStorage(candidate)
  return summarizeRejectedCandidateValue(redacted.value)
}

function summarizeRejectedCandidateValue(candidate: unknown): Record<string, unknown> {
  const confidence = extractConfidenceDiagnostic(candidate)
  const citations = summarizeCitationDiagnostics(extractCitations(candidate))
  const diagnostics: Record<string, unknown> = {}

  if (confidence !== undefined) diagnostics.confidence = confidence
  if (citations) diagnostics.citations = citations

  return {
    preview: limitPreview(rejectedCandidatePreview(candidate, confidence, citations?.count)),
    diagnostics,
  }
}

function rejectedCandidatePreview(candidate: unknown, confidence: number | undefined, citationCount: number | undefined): string {
  const details: string[] = []
  if (confidence !== undefined) details.push(`confidence ${confidence}`)
  if (citationCount !== undefined) details.push(`${citationCount} citation(s)`)
  const suffix = details.length ? ` with ${details.join(' and ')}` : ''
  return `${rejectedCandidateKind(candidate)} rejected${suffix}`
}

function extractConfidenceDiagnostic(candidate: unknown): number | undefined {
  if (!candidate || typeof candidate !== 'object') return undefined
  const direct = (candidate as Record<string, unknown>).confidence
  if (typeof direct === 'number' && Number.isFinite(direct)) return Number(direct.toFixed(4))

  const payload = (candidate as Record<string, unknown>).payload
  if (!payload || typeof payload !== 'object') return undefined
  const nested = (payload as Record<string, unknown>).confidence
  return typeof nested === 'number' && Number.isFinite(nested) ? Number(nested.toFixed(4)) : undefined
}

function extractCitations(candidate: unknown): Array<Record<string, unknown>> {
  if (!candidate || typeof candidate !== 'object') return []
  const direct = (candidate as Record<string, unknown>).citations
  if (Array.isArray(direct)) return direct.filter(isRecord)

  const payload = (candidate as Record<string, unknown>).payload
  if (!payload || typeof payload !== 'object') return []
  const nested = (payload as Record<string, unknown>).citations
  return Array.isArray(nested) ? nested.filter(isRecord) : []
}

interface RejectedCitationDiagnostics {
  count: number
  types: string[]
  withHash: number
  withoutHash: number
}

function summarizeCitationDiagnostics(citations: Array<Record<string, unknown>>): RejectedCitationDiagnostics | undefined {
  if (!citations.length) return undefined
  const types = [...new Set(citations.map((citation) => safeCitationType(citation.type)))].sort()
  const withHash = citations.filter((citation) => typeof citation.hash === 'string' && citation.hash.length > 0).length
  return {
    count: citations.length,
    types,
    withHash,
    withoutHash: citations.length - withHash,
  }
}

function safeCitationType(type: unknown): string {
  switch (type) {
    case 'file':
    case 'git':
    case 'tool_event':
    case 'message':
    case 'memory':
    case 'ide':
    case 'config':
    case 'task':
    case 'diagnostic':
      return type
    default:
      return 'unknown'
  }
}

function rejectedCandidateKind(candidate: unknown): string {
  if (Array.isArray(candidate)) return 'array candidate'
  if (!candidate || typeof candidate !== 'object') return 'candidate'

  const value = candidate as Record<string, unknown>
  if ('runLoopId' in value && 'userMessage' in value && 'assistantMessages' in value) return 'harvest candidate'
  if ('schemaVersion' in value && 'distiller' in value && 'payload' in value) return 'distiller envelope'
  if ('kind' in value && 'scope' in value && 'content' in value && 'citations' in value) return 'context fact candidate'
  if ('sourceProvider' in value && 'metadata' in value && 'hash' in value) return 'raw evidence candidate'
  return 'object candidate'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function limitPreview(value: string): string {
  const sanitized = sanitizeStoreText(value).replace(/\s+/g, ' ').trim()
  return sanitized.length <= 180 ? sanitized : `${sanitized.slice(0, 177)}...`
}

function sanitizeStoreText(value: string): string {
  return redactForDurableStorage(value).value.replace(/(raw[_ -]?thinking|chain[-_ ]of[-_ ]thought|reasoning(?:_summary)?)/gi, '[redacted reasoning]')
}
