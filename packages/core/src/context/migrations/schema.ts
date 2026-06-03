export const CONTEXT_STORE_SCHEMA_VERSION = 1
export const CONTEXT_SCHEMA_VERSION_KEY = 'context_schema_version'

export const CREATE_CONTEXT_STORE_TABLES = [
  `CREATE TABLE IF NOT EXISTS schema_meta(
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS raw_evidence(
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    cwd TEXT NOT NULL,
    source_provider TEXT NOT NULL,
    kind TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    captured_at INTEGER NOT NULL,
    hash TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS context_facts(
    id TEXT PRIMARY KEY,
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
    expires_at INTEGER,
    origin_json TEXT,
    tags_json TEXT,
    related_files_json TEXT,
    related_symbols_json TEXT,
    related_tasks_json TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS context_bundles(
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    bundle_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS harvest_jobs(
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    run_loop_id TEXT NOT NULL,
    status TEXT NOT NULL,
    candidate_json TEXT NOT NULL,
    decision_json TEXT,
    model_binding_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memory_records(
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    scope TEXT NOT NULL,
    content TEXT NOT NULL,
    citations_json TEXT NOT NULL,
    confidence REAL NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS context_diagnostics(
    id TEXT PRIMARY KEY,
    level TEXT NOT NULL,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    citation_json TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS rejected_candidates(
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL,
    candidate_json TEXT NOT NULL,
    rejection_reason TEXT NOT NULL,
    validation_errors_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
]

export const CREATE_CONTEXT_STORE_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_raw_evidence_session ON raw_evidence(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_raw_evidence_cwd ON raw_evidence(cwd)`,
  `CREATE INDEX IF NOT EXISTS idx_context_facts_scope ON context_facts(scope)`,
  `CREATE INDEX IF NOT EXISTS idx_context_facts_kind ON context_facts(kind)`,
  `CREATE INDEX IF NOT EXISTS idx_context_facts_updated ON context_facts(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_context_bundles_session ON context_bundles(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_harvest_jobs_session ON harvest_jobs(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_harvest_jobs_status ON harvest_jobs(status)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_records_scope ON memory_records(scope)`,
  `CREATE INDEX IF NOT EXISTS idx_rejected_candidates_session ON rejected_candidates(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rejected_candidates_expires ON rejected_candidates(expires_at)`,
]

export function getContextStoreMigrationStatements(fromVersion: number, toVersion = CONTEXT_STORE_SCHEMA_VERSION): string[] | null {
  if (fromVersion === toVersion) return []
  if (fromVersion === 0 && toVersion === 1) return [...CREATE_CONTEXT_STORE_TABLES, ...CREATE_CONTEXT_STORE_INDEXES, setSchemaVersionStatement(toVersion)]
  return null
}

export function createContextStoreSchemaStatements(version = CONTEXT_STORE_SCHEMA_VERSION): string[] {
  return [...CREATE_CONTEXT_STORE_TABLES, ...CREATE_CONTEXT_STORE_INDEXES, setSchemaVersionStatement(version)]
}

function setSchemaVersionStatement(version: number): string {
  return `INSERT OR REPLACE INTO schema_meta(key, value) VALUES('${CONTEXT_SCHEMA_VERSION_KEY}', '${version}')`
}
