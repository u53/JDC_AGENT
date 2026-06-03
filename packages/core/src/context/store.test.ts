import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import initSqlJs from 'sql.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONTEXT_STORE_SCHEMA_VERSION, closeAllContextStores, closeContextStore, openContextStore } from './store.js'
import type { ContextBundle, ContextCitation, ContextDiagnostic, ContextFact, HarvestJob, RawEvidence } from './types.js'

const citation: ContextCitation = { id: 'cit_file_1', type: 'file', ref: 'src/file.ts', hash: 'hash_1' }

let tmpDirs: string[] = []

afterEach(async () => {
  await closeAllContextStores()
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
  tmpDirs = []
})

describe('JDC Context Store persistence', () => {
  it('opens the default store under the current project .jdcagnet context-engine root', async () => {
    const projectDir = makeTempDir()
    const previousCwd = process.cwd()
    process.chdir(projectDir)

    try {
      const store = await openContextStore({ now: () => 1_000 })
      const info = await store.getSchemaInfo()

      expect(info.ok).toBe(true)
      expect(info.value.dbPath).toBe(path.join(process.cwd(), '.jdcagnet', 'context-engine', 'context.db'))
      expect(existsSync(info.value.dbPath)).toBe(true)
    } finally {
      process.chdir(previousCwd)
    }
  })

  it('isolates default stores by project cwd so project facts do not leak', async () => {
    const projectA = makeTempDir()
    const projectB = makeTempDir()

    const storeA = await openContextStore({ cwd: projectA, now: () => 1_000 })
    await saveFileEvidence(storeA, { cwd: projectA })
    await expectOk(storeA.saveFact(makeFact({ id: 'fact_project_a' })))

    const storeB = await openContextStore({ cwd: projectB, now: () => 1_000 })
    await saveFileEvidence(storeB, { id: 'evidence_b', cwd: projectB })
    await expectOk(storeB.saveFact(makeFact({ id: 'fact_project_b' })))

    expect((await storeA.queryFacts()).value.map((fact) => fact.id)).toEqual(['fact_project_a'])
    expect((await storeB.queryFacts()).value.map((fact) => fact.id)).toEqual(['fact_project_b'])

    const reopenedA = await openContextStore({ cwd: projectA })
    expect((await reopenedA.queryFacts()).value.map((fact) => fact.id)).toEqual(['fact_project_a'])
  })

  it('shares accepted durable project facts across same-cwd stores while retaining session provenance', async () => {
    const projectDir = makeTempDir()

    const sessionAStore = await openContextStore({ cwd: projectDir, now: () => 1_000 })
    await saveFileEvidence(sessionAStore, { cwd: projectDir, sessionId: 'session_a' })
    await expectOk(sessionAStore.saveFact(makeFact({ id: 'fact_from_session_a', sessionId: 'session_a' })))

    const sessionBStore = await openContextStore({ cwd: projectDir, now: () => 2_000 })
    const sessionBInitialFacts = await sessionBStore.listAcceptedProjectFacts()
    expect(sessionBInitialFacts.value).toMatchObject([
      { id: 'fact_from_session_a', sessionId: 'session_a' },
    ])

    await saveFileEvidence(sessionBStore, { id: 'evidence_b', cwd: projectDir, sessionId: 'session_b', metadata: { file: 'src/other.ts' }, hash: 'hash_b' })
    await expectOk(sessionBStore.saveFact(makeFact({
      id: 'fact_from_session_b',
      sessionId: 'session_b',
      citations: [{ id: 'cit_file_b', type: 'file', ref: 'src/other.ts', hash: 'hash_b' }],
      updatedAt: 2,
    })))

    const reopenedSessionAStore = await openContextStore({ cwd: projectDir, now: () => 3_000 })
    const sharedFacts = await reopenedSessionAStore.listAcceptedProjectFacts()

    expect(sharedFacts.value.map((fact) => [fact.id, fact.sessionId])).toEqual([
      ['fact_from_session_b', 'session_b'],
      ['fact_from_session_a', 'session_a'],
    ])
  })

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
    } as any)

    await expectOk(store.saveFact(fact))

    const saved = (await store.queryFacts()).value[0]!
    expect(saved.origin).toEqual(fact.origin)
    expect(saved.tags).toEqual(['release', 'workflow'])
    expect(saved.relatedFiles).toEqual(['package.json', '.github/workflows/release.yml'])
    expect(saved.relatedSymbols).toEqual(['runRelease'])
    expect(saved.relatedTasks).toEqual(['task_release'])
  })

  it('keeps same-cwd stores live-consistent when both are opened before a write', async () => {
    const projectDir = makeTempDir()
    const sessionAStore = await openContextStore({ cwd: projectDir, now: () => 1_000 })
    const sessionBStore = await openContextStore({ cwd: path.join(projectDir, '.'), now: () => 2_000 })

    await saveFileEvidence(sessionAStore, { cwd: projectDir, sessionId: 'session_a' })
    await expectOk(sessionAStore.saveFact(makeFact({ id: 'live_fact_from_session_a', sessionId: 'session_a' })))

    const sessionBFacts = await sessionBStore.listAcceptedProjectFacts()

    expect(sessionBFacts.value).toMatchObject([
      { id: 'live_fact_from_session_a', sessionId: 'session_a' },
    ])
  })

  it('isolates facts and citation validation by cwd when stores share an explicit dbPath', async () => {
    const dbPath = makeDbPath()
    const projectA = makeTempDir()
    const projectB = makeTempDir()

    const storeA = await openContextStore({ dbPath, cwd: projectA, now: () => 1_000 })
    await saveFileEvidence(storeA, { cwd: projectA })
    await expectOk(storeA.saveFact(makeFact({ id: 'fact_project_a' })))

    const storeB = await openContextStore({ dbPath, cwd: projectB, now: () => 1_000 })
    const saveWithoutLocalCitation = await storeB.saveFact(makeFact({ id: 'fact_project_b_without_evidence' }))
    expect(saveWithoutLocalCitation.ok).toBe(false)

    await saveFileEvidence(storeB, { id: 'evidence_b', cwd: projectB })
    await expectOk(storeB.saveFact(makeFact({ id: 'fact_project_b' })))

    const reopenedA = await openContextStore({ dbPath, cwd: projectA })
    const reopenedB = await openContextStore({ dbPath, cwd: projectB })

    expect((await reopenedA.queryFacts()).value.map((fact) => fact.id)).toEqual(['fact_project_a'])
    expect((await reopenedB.queryFacts()).value.map((fact) => fact.id)).toEqual(['fact_project_b'])
  })

  it('shares one live database for different projects using the same explicit dbPath', async () => {
    const dbPath = makeDbPath()
    const projectA = makeTempDir()
    const projectB = makeTempDir()

    const storeA = await openContextStore({ dbPath, cwd: projectA, now: () => 1_000 })
    const storeB = await openContextStore({ dbPath, cwd: projectB, now: () => 1_000 })

    await saveFileEvidence(storeA, { id: 'evidence_a', cwd: projectA, sessionId: 'session_a', metadata: { file: 'src/a.ts' }, hash: 'hash_a' })
    await expectOk(storeA.saveFact(makeFact({
      id: 'fact_a',
      sessionId: 'session_a',
      citations: [{ id: 'cit_a', type: 'file', ref: 'src/a.ts', hash: 'hash_a' }],
    })))

    await saveFileEvidence(storeB, { id: 'evidence_b', cwd: projectB, sessionId: 'session_b', metadata: { file: 'src/b.ts' }, hash: 'hash_b' })
    await expectOk(storeB.saveFact(makeFact({
      id: 'fact_b',
      sessionId: 'session_b',
      citations: [{ id: 'cit_b', type: 'file', ref: 'src/b.ts', hash: 'hash_b' }],
    })))

    await saveFileEvidence(storeA, { id: 'evidence_a2', cwd: projectA, sessionId: 'session_a', metadata: { file: 'src/a2.ts' }, hash: 'hash_a2' })
    await expectOk(storeA.saveFact(makeFact({
      id: 'fact_a2',
      sessionId: 'session_a',
      citations: [{ id: 'cit_a2', type: 'file', ref: 'src/a2.ts', hash: 'hash_a2' }],
      updatedAt: 2,
    })))

    expect(await readPersistedFactIds(dbPath)).toEqual(['fact_a', 'fact_a2', 'fact_b'])
    expect((await storeA.queryFacts()).value.map((fact) => fact.id)).toEqual(['fact_a', 'fact_a2'])
    expect((await storeB.queryFacts()).value.map((fact) => fact.id)).toEqual(['fact_b'])
  })

  it('keeps matching logical ids independent when projects share a dbPath', async () => {
    const dbPath = makeDbPath()
    const projectA = makeTempDir()
    const projectB = makeTempDir()

    const storeA = await openContextStore({ dbPath, cwd: projectA, now: () => 1_000 })
    const storeB = await openContextStore({ dbPath, cwd: projectB, now: () => 1_000 })

    await saveFileEvidence(storeA, { cwd: projectA })
    await saveFileEvidence(storeB, { cwd: projectB })

    await expectOk(storeA.saveFact(makeFact({ id: 'shared_fact_id', content: 'Project A fact.' })))
    await expectOk(storeB.saveFact(makeFact({ id: 'shared_fact_id', content: 'Project B fact.' })))

    expect((await storeA.queryFacts()).value).toMatchObject([{ id: 'shared_fact_id', content: 'Project A fact.' }])
    expect((await storeB.queryFacts()).value).toMatchObject([{ id: 'shared_fact_id', content: 'Project B fact.' }])
  })

  it('coalesces provider evidence writes and flushes once at the bundle snapshot boundary', async () => {
    const dbPath = makeDbPath()
    const store = await openContextStore({ dbPath, now: () => 1_000 })
    const SQL = await initSqlJs()
    const exportSpy = vi.spyOn(SQL.Database.prototype, 'export')

    try {
      await expectOk(store.saveRawEvidence(makeEvidence({ id: 'evidence_1' })))
      await expectOk(store.saveRawEvidence(makeEvidence({ id: 'evidence_2', metadata: { file: 'src/other.ts' }, hash: 'hash_2' })))
      await expectOk(store.saveRawEvidence(makeEvidence({ id: 'evidence_3', metadata: { file: 'src/third.ts' }, hash: 'hash_3' })))
      await expectOk(store.saveBundleSnapshot(makeBundle({ id: 'bundle_after_evidence' })))

      expect(exportSpy).toHaveBeenCalledTimes(1)
      expect((await store.listRawEvidence()).value.map((evidence) => evidence.id)).toEqual(['evidence_1', 'evidence_2', 'evidence_3'])
    } finally {
      exportSpy.mockRestore()
    }
  })

  it('persists and queries facts by scope, freshness, confidence, and citation', async () => {
    const dbPath = makeDbPath()
    const store = await openContextStore({ dbPath, now: () => 1_000 })
    await saveFileEvidence(store)
    await saveFileEvidence(store, { id: 'evidence_other', metadata: { file: 'src/other.ts' } })

    await expectOk(store.saveFact(makeFact({ id: 'fact_project', scope: 'project', freshness: 'recent', confidence: 0.9 })))
    await expectOk(
      store.saveFact(
        makeFact({
          id: 'fact_session',
          scope: 'session',
          freshness: 'stale',
          confidence: 0.8,
          citations: [{ ...citation, id: 'cit_file_2', ref: 'src/other.ts' }],
        })
      )
    )

    const result = await store.queryFacts({ scope: 'project', freshness: 'recent', minConfidence: 0.8, citationRef: 'src/file.ts' })
    expect(result.ok).toBe(true)
    expect(result.value.map((fact) => fact.id)).toEqual(['fact_project'])

    const reopened = await openContextStore({ dbPath })
    const persisted = await reopened.queryFacts({ scope: 'project' })
    expect(persisted.ok).toBe(true)
    expect(persisted.value.map((fact) => fact.id)).toEqual(['fact_project'])
  })

  it('excludes stale facts by default while allowing explicit stale inspection', async () => {
    const store = await openContextStore({ dbPath: makeDbPath(), now: () => 1_000 })
    await saveFileEvidence(store)

    await expectOk(store.saveFact(makeFact({ id: 'fact_recent', freshness: 'recent' })))
    await expectOk(store.saveFact(makeFact({ id: 'fact_stale', freshness: 'stale' })))

    expect((await store.queryFacts()).value.map((fact) => fact.id)).toEqual(['fact_recent'])
    expect((await store.queryFacts({ includeStale: true })).value.map((fact) => fact.id)).toEqual(['fact_recent', 'fact_stale'])
    expect((await store.queryFacts({ freshness: 'stale' })).value.map((fact) => fact.id)).toEqual(['fact_stale'])
  })

  it('filters high-value fact kinds before applying newest-first limits', async () => {
    const store = await openContextStore({ dbPath: makeDbPath(), now: () => 1_000 })
    await saveFileEvidence(store)

    await expectOk(store.saveFact(makeFact({ id: 'generic_recent', kind: 'user_preference', updatedAt: 300 })))
    await expectOk(store.saveFact(makeFact({ id: 'known_issue', kind: 'known_issue', updatedAt: 200 })))
    await expectOk(store.saveFact(makeFact({ id: 'current_goal', kind: 'current_goal', updatedAt: 400 })))

    const result = await store.queryFacts({
      includeStale: true,
      kinds: ['current_goal', 'known_issue'],
      orderBy: 'updated_desc',
      limit: 1,
    })

    expect(result.ok).toBe(true)
    expect(result.value.map((fact) => fact.id)).toEqual(['current_goal'])
  })

  it('migrates an old schema and rebuilds a future schema without throwing', async () => {
    const oldDbPath = makeDbPath()
    await writeDatabase(oldDbPath, [`CREATE TABLE schema_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)`, `INSERT INTO schema_meta(key, value) VALUES('context_schema_version', '0')`])

    const migrated = await openContextStore({ dbPath: oldDbPath })
    const migratedInfo = await migrated.getSchemaInfo()
    expect(migratedInfo.ok).toBe(true)
    expect(migratedInfo.value.version).toBe(CONTEXT_STORE_SCHEMA_VERSION)
    await expectOk(migrated.saveRawEvidence(makeEvidence({ id: 'evidence_after_migration' })))

    const futureDbPath = makeDbPath()
    await writeDatabase(futureDbPath, [`CREATE TABLE schema_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)`, `INSERT INTO schema_meta(key, value) VALUES('context_schema_version', '999')`])

    const rebuilt = await openContextStore({ dbPath: futureDbPath, now: () => 123_456 })
    const rebuiltInfo = await rebuilt.getSchemaInfo()
    expect(rebuiltInfo.ok).toBe(true)
    expect(rebuiltInfo.value.version).toBe(CONTEXT_STORE_SCHEMA_VERSION)
    expect(rebuiltInfo.value.backupPath).toBe(`${futureDbPath}.backup-123456`)
    expect(existsSync(`${futureDbPath}.backup-123456`)).toBe(true)
    await saveFileEvidence(rebuilt)
    await expectOk(rebuilt.saveFact(makeFact({ id: 'fact_after_rebuild' })))
  })

  it('backfills project isolation fields for current-version legacy rows', async () => {
    const dbPath = makeDbPath()
    const projectDir = makeTempDir()
    await writeDatabase(dbPath, [
      `CREATE TABLE schema_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      `INSERT INTO schema_meta(key, value) VALUES('context_schema_version', '1')`,
      `CREATE TABLE raw_evidence(
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
      `CREATE TABLE context_facts(
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
        expires_at INTEGER
      )`,
      `INSERT INTO raw_evidence(id, session_id, cwd, source_provider, kind, content, metadata_json, captured_at, hash)
       VALUES('legacy_evidence', 'session_legacy', '${projectDir}', 'LegacyProvider', 'message', 'legacy proof', '{"messageId":"msg_legacy"}', 1000, 'hash_legacy')`,
      `INSERT INTO context_facts(id, kind, scope, content, citations_json, confidence, freshness, source_provider, session_id, created_at, updated_at, expires_at)
       VALUES('legacy_fact', 'workflow_rule', 'project', 'Legacy project fact stays visible after isolation upgrade.', '[{"id":"cit_legacy","type":"message","ref":"msg_legacy"}]', 0.9, 'recent', 'LegacyProvider', 'session_legacy', 1000, 1000, NULL)`,
    ])

    const store = await openContextStore({ dbPath, cwd: projectDir, now: () => 2_000 })
    const facts = await store.queryFacts()

    expect(facts.value).toMatchObject([
      { id: 'legacy_fact', sessionId: 'session_legacy', content: 'Legacy project fact stays visible after isolation upgrade.' },
    ])
  })

  it('backfills legacy explicit-db rows by row ownership instead of first opener', async () => {
    const dbPath = makeDbPath()
    const projectA = makeTempDir()
    const projectB = makeTempDir()
    await writeDatabase(dbPath, legacyMultiProjectStatements(projectA, projectB))

    const storeA = await openContextStore({ dbPath, cwd: projectA, now: () => 2_000 })
    const factsA = await storeA.queryFacts()
    const storeB = await openContextStore({ dbPath, cwd: projectB, now: () => 2_000 })
    const factsB = await storeB.queryFacts()

    expect(factsA.value.map((fact) => fact.id)).toEqual(['legacy_fact_a'])
    expect(factsB.value.map((fact) => fact.id)).toEqual(['legacy_fact_b'])
    expect(await readUnassignedFactIds(dbPath)).toEqual(['legacy_fact_orphan'])
  })

  it('closes shared context stores without deleting persisted data', async () => {
    const projectDir = makeTempDir()
    const store = await openContextStore({ cwd: projectDir, now: () => 1_000 })
    await saveFileEvidence(store, { cwd: projectDir })
    await expectOk(store.saveFact(makeFact({ id: 'fact_before_close' })))

    await closeContextStore({ cwd: projectDir })
    const reopened = await openContextStore({ cwd: projectDir, now: () => 2_000 })

    expect((await reopened.queryFacts()).value.map((fact) => fact.id)).toEqual(['fact_before_close'])
  })

  it('rejects missing and self-proof citations while accepting valid external evidence citations', async () => {
    const store = await openContextStore({ dbPath: makeDbPath(), now: () => 1_000 })

    const missingCitationSave = await store.saveFact(makeFact({ id: 'missing_citation_fact', citations: [] }))
    expect(missingCitationSave.ok).toBe(false)

    const selfProofMessageSave = await store.saveFact(
      makeFact({
        id: 'self_proof_message_fact',
        citations: [{ id: 'cit_fake_message', type: 'message', ref: 'missing_message' }],
      })
    )
    expect(selfProofMessageSave.ok).toBe(false)

    const selfProofFileSave = await store.saveFact(
      makeFact({
        id: 'self_proof_file_fact',
        citations: [{ id: 'cit_fake_file', type: 'file', ref: 'src/fake.ts', hash: 'fake_hash' }],
      })
    )
    expect(selfProofFileSave.ok).toBe(false)

    await expectOk(store.saveRawEvidence(makeEvidence({ id: 'external_message_evidence', kind: 'message', content: 'User prefers TDD.', metadata: { messageId: 'msg_1' }, hash: 'message_hash_1' })))
    const validExternalSave = await store.saveFact(
      makeFact({
        id: 'valid_external_fact',
        citations: [{ id: 'cit_msg_1', type: 'message', ref: 'msg_1' }],
      })
    )
    expect(validExternalSave.ok).toBe(true)

    const facts = await store.queryFacts()
    expect(facts.value.map((fact) => fact.id)).toEqual(['valid_external_fact'])
  })

  it('retains rejected invalid facts as minimized previews instead of payload copies', async () => {
    const store = await openContextStore({ dbPath: makeDbPath(), now: () => 1_000 })
    const unsafeFact = makeFact({
      id: 'unsafe_fact',
      content: 'Store token ghp_1234567890abcdefghijklmnopqrstuvwxyz safely in this rejected candidate payload.',
      citations: [{ id: 'cit_fake_message', type: 'message', ref: 'missing_message' }],
    })

    const save = await store.saveFact(unsafeFact)
    expect(save.ok).toBe(false)

    const facts = await store.queryFacts()
    expect(facts.value).toEqual([])

    const rejected = await store.listRejectedCandidates({ includeExpired: true })
    expect(rejected.value).toHaveLength(1)
    expect(rejected.value[0]).toMatchObject({ sessionId: 'unknown', status: 'rejected', rejectionReason: expect.stringContaining('message citation cit_fake_message references missing message missing_message') })
    expect(rejected.value[0].createdAt).toBe(1_000)
    expect(rejected.value[0].validationErrors).toEqual([expect.stringContaining('message citation cit_fake_message references missing message missing_message')])

    const persistedCandidate = JSON.stringify(rejected.value[0].candidate)
    expect(persistedCandidate.length).toBeLessThanOrEqual(512)
    expect(persistedCandidate).toContain('preview')
    expect(persistedCandidate).toContain('confidence')
    expect(persistedCandidate).toContain('citation')
    expect(persistedCandidate).not.toContain('content')
    expect(persistedCandidate).not.toContain('Store token')
    expect(persistedCandidate).not.toContain('ghp_1234567890')
    expect(persistedCandidate).not.toContain('cit_fake_message')
    expect(persistedCandidate).not.toContain('missing_message')
  })

  it('minimizes directly rejected harvest payloads without retaining raw messages, evidence, or reasoning', async () => {
    const store = await openContextStore({ dbPath: makeDbPath(), now: () => 2_000 })

    await expectOk(store.rejectCandidate(
      {
        sessionId: 'session_1',
        runLoopId: 'run_1',
        userMessage: 'Remember database_url=postgres://user:secret@localhost/db and the raw evidence below.',
        assistantMessages: [{ id: 'assistant_1', role: 'assistant', content: [{ type: 'thinking', thinking: 'raw thinking says keep this hidden preference' }], timestamp: 1 }],
        rawEvidence: { content: 'private key -----BEGIN PRIVATE KEY-----abc-----END PRIVATE KEY-----', metadata: { token: 'ghp_1234567890abcdefghijklmnopqrstuvwxyz' } },
        confidence: 0.41,
        citations: [{ id: 'cit_msg_secret', type: 'message', ref: 'secret_msg' }],
        createdAt: 1,
      },
      'low confidence with citation mismatch for secret_msg',
      { id: 'rejected_harvest_payload', sessionId: 'session_1', createdAt: 2_000, validationErrors: ['confidence 0.41 below threshold', 'citation cit_msg_secret missing'] }
    ))

    const rejected = await store.listRejectedCandidates({ sessionId: 'session_1', includeExpired: true })
    expect(rejected.value).toHaveLength(1)
    expect(rejected.value[0]).toMatchObject({ id: 'rejected_harvest_payload', status: 'rejected', createdAt: 2_000 })
    expect(rejected.value[0].rejectionReason).toContain('secret_msg')
    expect(rejected.value[0].validationErrors).toEqual(['confidence 0.41 below threshold', 'citation cit_msg_secret missing'])

    const persistedCandidate = JSON.stringify(rejected.value[0].candidate)
    expect(persistedCandidate.length).toBeLessThanOrEqual(512)
    expect(persistedCandidate).toContain('preview')
    expect(persistedCandidate).toContain('0.41')
    expect(persistedCandidate).toContain('citation')
    expect(persistedCandidate).not.toContain('userMessage')
    expect(persistedCandidate).not.toContain('assistantMessages')
    expect(persistedCandidate).not.toContain('rawEvidence')
    expect(persistedCandidate).not.toContain('database_url')
    expect(persistedCandidate).not.toContain('postgres://')
    expect(persistedCandidate).not.toContain('raw thinking')
    expect(persistedCandidate).not.toContain('hidden preference')
    expect(persistedCandidate).not.toContain('ghp_1234567890')
    expect(persistedCandidate).not.toContain('PRIVATE KEY')
    expect(persistedCandidate).not.toContain('cit_msg_secret')
    expect(persistedCandidate).not.toContain('secret_msg')
  })

  it('keeps accepted durable facts separate from operational harvest noise', async () => {
    const dir = makeTempDir()
    const store = await openContextStore({ cwd: dir, now: () => 10_000 })
    await saveFileEvidence(store, { cwd: dir })
    await store.saveFact(makeFact({ id: 'project_rule', content: 'Run pnpm build before release.', scope: 'project', confidence: 0.91 }))
    await store.rejectCandidate({ action: 'skip', reason: 'model_noop' }, 'Harvest model skipped durable storage: model_noop', {
      id: 'noop_candidate',
      sessionId: 'session_1',
      createdAt: 10_000,
      validationErrors: ['model_noop'],
      status: 'rejected',
    })

    const facts = await store.listAcceptedProjectFacts()
    expect(facts.value.map((item) => item.id)).toEqual(['project_rule'])

    const diagnostics = await store.listAdvancedDiagnostics({ sessionId: 'session_1', includeNoop: true })
    expect(diagnostics.value.rejected.map((item) => item.id)).toEqual(['noop_candidate'])
    expect(diagnostics.value.harvestJobs).toEqual([])
  })

  it('lists recent accepted project facts first and applies query limit in the store', async () => {
    const store = await openContextStore({ dbPath: makeDbPath(), now: () => 10_000 })
    await saveFileEvidence(store)

    await expectOk(store.saveFact(makeFact({ id: 'fact_old', updatedAt: 10 })))
    await expectOk(store.saveFact(makeFact({ id: 'fact_mid', updatedAt: 20 })))
    await expectOk(store.saveFact(makeFact({ id: 'fact_new', updatedAt: 30 })))

    const facts = await store.listAcceptedProjectFacts({ limit: 2 })

    expect(facts.value.map((item) => item.id)).toEqual(['fact_new', 'fact_mid'])
  })

  it('applies accepted fact limit after citation filters', async () => {
    const store = await openContextStore({ dbPath: makeDbPath(), now: () => 10_000 })
    await saveFileEvidence(store)
    await saveFileEvidence(store, { id: 'evidence_other', metadata: { file: 'src/other.ts' }, hash: 'other_hash' })

    await expectOk(store.saveFact(makeFact({ id: 'fact_matching_old', updatedAt: 10, citations: [{ ...citation, hash: 'hash_1' }] })))
    await expectOk(store.saveFact(makeFact({ id: 'fact_nonmatching_newer_1', updatedAt: 30, citations: [{ id: 'cit_other_1', type: 'file', ref: 'src/other.ts', hash: 'other_hash' }] })))
    await expectOk(store.saveFact(makeFact({ id: 'fact_nonmatching_newer_2', updatedAt: 40, citations: [{ id: 'cit_other_2', type: 'file', ref: 'src/other.ts', hash: 'other_hash' }] })))

    const facts = await store.listAcceptedProjectFacts({ citationRef: 'src/file.ts', limit: 1 })

    expect(facts.value.map((item) => item.id)).toEqual(['fact_matching_old'])
  })

  it('persists primary UI visibility for diagnostics and harvest jobs', async () => {
    const dbPath = makeDbPath()
    const store = await openContextStore({ dbPath, now: () => 1_000 })

    await expectOk(store.saveDiagnostic(makeDiagnostic({ visibleInPrimaryUi: false })))
    await expectOk(store.saveHarvestJob(makeHarvestJob({ visibleInPrimaryUi: false })))

    const reopened = await openContextStore({ dbPath, now: () => 2_000 })

    expect((await reopened.listDiagnostics()).value[0]?.visibleInPrimaryUi).toBe(false)
    expect((await reopened.listHarvestJobs()).value[0]?.visibleInPrimaryUi).toBe(false)
  })

  it('enforces quotas for facts, bundle snapshots, raw evidence, and rejected candidates', async () => {
    const store = await openContextStore({
      dbPath: makeDbPath(),
      now: () => 10_000,
      quotas: { maxFacts: 2, maxBundleSnapshots: 2, maxRejectedCandidates: 2, rawEvidenceTtlMs: 100 },
    })
    await saveFileEvidence(store)

    await expectOk(store.saveFact(makeFact({ id: 'fact_keep_high', confidence: 0.95, updatedAt: 20 })))
    await expectOk(store.saveFact(makeFact({ id: 'fact_drop_low', confidence: 0.81, updatedAt: 30 })))
    await expectOk(store.saveFact(makeFact({ id: 'fact_keep_fresh', confidence: 0.82, updatedAt: 40 })))

    await expectOk(store.saveBundleSnapshot(makeBundle({ id: 'bundle_drop', createdAt: 1 })))
    await expectOk(store.saveBundleSnapshot(makeBundle({ id: 'bundle_keep_1', createdAt: 2 })))
    await expectOk(store.saveBundleSnapshot(makeBundle({ id: 'bundle_keep_2', createdAt: 3 })))

    await expectOk(store.saveRawEvidence(makeEvidence({ id: 'raw_expired', capturedAt: 9_000 })))
    await expectOk(store.saveRawEvidence(makeEvidence({ id: 'raw_keep', capturedAt: 9_950 })))

    await expectOk(store.rejectCandidate({ id: 'candidate_drop_by_count' }, 'low confidence', { id: 'rejected_drop_count', sessionId: 'session_1', createdAt: 1, ttlMs: 10_000 }))
    await expectOk(store.rejectCandidate({ id: 'candidate_keep_1' }, 'missing citation', { id: 'rejected_keep_1', sessionId: 'session_1', createdAt: 2, ttlMs: 10_000 }))
    await expectOk(store.rejectCandidate({ id: 'candidate_keep_2' }, 'duplicate', { id: 'rejected_keep_2', sessionId: 'session_1', createdAt: 3, ttlMs: 10_000 }))

    const quota = await store.enforceQuotas()
    expect(quota.ok).toBe(true)
    expect(quota.value).toMatchObject({ deletedFacts: 1, deletedBundles: 1, deletedRawEvidence: 2, deletedRejectedCandidates: 1 })

    expect((await store.queryFacts()).value.map((fact) => fact.id)).toEqual(['fact_keep_high', 'fact_keep_fresh'])
    expect((await store.listBundleSnapshots()).value.map((bundle) => bundle.id)).toEqual(['bundle_keep_1', 'bundle_keep_2'])
    expect((await store.listRawEvidence()).value.map((evidence) => evidence.id)).toEqual(['raw_keep'])
    expect((await store.listRejectedCandidates()).value.map((candidate) => candidate.id)).toEqual(['rejected_keep_1', 'rejected_keep_2'])
  })

  it('retains rejected candidates temporarily and removes them after their TTL expires', async () => {
    const store = await openContextStore({ dbPath: makeDbPath(), now: () => 1_000, quotas: { maxRejectedCandidates: 10 } })

    await expectOk(store.rejectCandidate({ id: 'candidate_old' }, 'missing citation', { id: 'rejected_old', sessionId: 'session_1', createdAt: 100, ttlMs: 200 }))
    await expectOk(store.rejectCandidate({ id: 'candidate_recent' }, 'sensitive content', { id: 'rejected_recent', sessionId: 'session_1', createdAt: 900, ttlMs: 500 }))

    expect((await store.listRejectedCandidates()).value.map((candidate) => candidate.id)).toEqual(['rejected_recent'])
    const quota = await store.enforceQuotas()
    expect(quota.ok).toBe(true)
    expect(quota.diagnostics).toEqual([])
    expect(quota.value).toMatchObject({ deletedRejectedCandidates: 1 })
    expect((await store.listRejectedCandidates({ includeExpired: true })).value.map((candidate) => candidate.id)).toEqual(['rejected_recent'])
  })

  it('marks file-cited facts stale when the file content hash changes', async () => {
    const store = await openContextStore({ dbPath: makeDbPath(), now: () => 1_000 })
    await saveFileEvidence(store)
    await saveFileEvidence(store, { id: 'evidence_other', metadata: { file: 'src/other.ts' }, hash: 'other_hash' })

    await expectOk(store.saveFact(makeFact({ id: 'fact_file', citations: [{ ...citation, hash: 'hash_1' }] })))
    await expectOk(store.saveFact(makeFact({ id: 'fact_other', citations: [{ id: 'cit_other', type: 'file', ref: 'src/other.ts', hash: 'other_hash' }] })))

    const result = await store.invalidateByFileHash('src/file.ts', 'hash_2_changed')
    expect(result.ok).toBe(true)
    expect(result.value.invalidatedFacts).toBe(1)

    const facts = await store.queryFacts({ includeStale: true })
    const byId = Object.fromEntries(facts.value.map((fact) => [fact.id, fact.freshness]))
    expect(byId['fact_file']).toBe('stale')
    expect(byId['fact_other']).toBe('recent')
  })

  it('normalizes absolute file paths before invalidating relative file citations', async () => {
    const projectDir = makeTempDir()
    const store = await openContextStore({ dbPath: makeDbPath(), cwd: projectDir, now: () => 1_000 })
    await saveFileEvidence(store, { cwd: projectDir })
    await expectOk(store.saveFact(makeFact({ id: 'fact_file', citations: [{ ...citation, hash: 'hash_1' }] })))

    const result = await store.invalidateByFileHash(path.join(projectDir, 'src/file.ts'), 'hash_2_changed')
    expect(result.ok).toBe(true)
    expect(result.value.invalidatedFacts).toBe(1)

    const facts = await store.queryFacts({ includeStale: true })
    expect(facts.value.find((fact) => fact.id === 'fact_file')?.freshness).toBe('stale')
  })

  it('does not invalidate file-cited facts when the hash still matches', async () => {
    const store = await openContextStore({ dbPath: makeDbPath(), now: () => 1_000 })
    await saveFileEvidence(store)
    await expectOk(store.saveFact(makeFact({ id: 'fact_file', citations: [{ ...citation, hash: 'hash_1' }] })))

    const result = await store.invalidateByFileHash('src/file.ts', 'hash_1')
    expect(result.ok).toBe(true)
    expect(result.value.invalidatedFacts).toBe(0)
    expect((await store.queryFacts()).value[0]?.freshness).toBe('recent')
  })

  it('falls back to diagnostics instead of throwing when the store cannot open', async () => {
    const dir = makeTempDir()
    const dbPath = path.join(dir, 'jdc-context.db')
    mkdirSync(dbPath)

    const store = await openContextStore({ dbPath })
    const query = await store.queryFacts()
    expect(query.ok).toBe(false)
    expect(query.value).toEqual([])
    expect(query.diagnostics[0]?.message).toContain('Context store unavailable')

    const save = await store.saveFact(makeFact({ id: 'fact_not_saved' }))
    expect(save.ok).toBe(false)
    expect(save.diagnostics[0]?.source).toBe('ContextStore')
  })

  it('approves and rejects pending review candidates by the public candidate id returned to UI', async () => {
    const store = await openContextStore({ dbPath: makeDbPath(), now: () => 1_000 })
    const envelope = pendingMemoryEnvelope('Remember approved project context.')
    await saveMessageEvidence(store, { id: 'run_1:user' })

    await expectOk(store.rejectCandidate(envelope, 'pending_review', {
      id: 'candidate_public_id',
      sessionId: 'session_1',
      createdAt: 1_000,
      status: 'pending_review',
    }))

    const listed = await store.listRejectedCandidates({ sessionId: 'session_1', includeExpired: true })
    expect(listed.value).toHaveLength(1)
    expect(listed.value[0]).toMatchObject({ id: 'candidate_public_id', status: 'pending_review' })

    const approved = await store.approvePendingCandidate(listed.value[0].id)
    expect(approved.ok).toBe(true)
    expect(approved.value).toMatchObject({ content: 'Remember approved project context.', freshness: 'recent' })
    expect((await store.listRejectedCandidates({ sessionId: 'session_1', includeExpired: true })).value).toEqual([])

    await expectOk(store.rejectCandidate(envelope, 'pending_review', {
      id: 'candidate_reject_id',
      sessionId: 'session_1',
      createdAt: 2_000,
      status: 'pending_review',
    }))
    const pendingReject = await store.listRejectedCandidates({ sessionId: 'session_1', includeExpired: true })
    const rejected = await store.rejectPendingCandidate(pendingReject.value[0].id)
    expect(rejected.ok).toBe(true)
    expect(rejected.value).toMatchObject({ id: 'candidate_reject_id', status: 'rejected' })
  })

  it('does not approve pending envelopes without stored citation proof into durable facts', async () => {
    const store = await openContextStore({ dbPath: makeDbPath(), now: () => 1_000 })
    const envelope = pendingMemoryEnvelope('Unproven context must not become durable.')

    await expectOk(store.rejectCandidate(envelope, 'pending_review', {
      id: 'candidate_unproven_id',
      sessionId: 'session_1',
      createdAt: 1_000,
      status: 'pending_review',
    }))

    const approved = await store.approvePendingCandidate('candidate_unproven_id')

    expect(approved.ok).toBe(false)
    expect(approved.value).toBeNull()
    expect(approved.diagnostics[0]?.message).toContain('missing message run_1:user')
    expect((await store.queryFacts()).value).toEqual([])
    expect((await store.listRejectedCandidates({ sessionId: 'session_1', includeExpired: true })).value).toMatchObject([
      { id: 'candidate_unproven_id', status: 'pending_review' },
    ])
  })

  it('does not approve pending envelopes with unknown distillers even when citations are proven', async () => {
    const store = await openContextStore({ dbPath: makeDbPath(), now: () => 1_000 })
    const envelope = { ...pendingMemoryEnvelope('Unknown distiller output must not become durable.'), distiller: 'UnknownDistiller' }
    await saveMessageEvidence(store, { id: 'run_1:user' })

    await expectOk(store.rejectCandidate(envelope, 'pending_review', {
      id: 'candidate_unknown_distiller_id',
      sessionId: 'session_1',
      createdAt: 1_000,
      status: 'pending_review',
    }))

    const approved = await store.approvePendingCandidate('candidate_unknown_distiller_id')

    expect(approved.ok).toBe(false)
    expect(approved.value).toBeNull()
    expect(approved.diagnostics[0]?.message).toContain('unknown distiller UnknownDistiller')
    expect((await store.queryFacts()).value).toEqual([])
    expect((await store.listRejectedCandidates({ sessionId: 'session_1', includeExpired: true })).value).toMatchObject([
      { id: 'candidate_unknown_distiller_id', status: 'pending_review' },
    ])
  })
})

async function expectOk(promise: Promise<{ ok: boolean; diagnostics: unknown[] }>) {
  const result = await promise
  expect(result.ok).toBe(true)
  expect(result.diagnostics).toEqual([])
}

async function saveFileEvidence(store: { saveRawEvidence(evidence: RawEvidence): Promise<{ ok: boolean; diagnostics: unknown[] }> }, overrides: Partial<RawEvidence> = {}) {
  await expectOk(store.saveRawEvidence(makeEvidence(overrides)))
}

async function saveMessageEvidence(store: { saveRawEvidence(evidence: RawEvidence): Promise<{ ok: boolean; diagnostics: unknown[] }> }, overrides: Partial<RawEvidence> = {}) {
  await expectOk(store.saveRawEvidence(makeEvidence({
    id: 'run_1:user',
    kind: 'message',
    content: 'Remember approved project context.',
    metadata: { messageId: 'run_1:user' },
    hash: 'message_hash_1',
    ...overrides,
  })))
}

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'jdc-context-store-'))
  tmpDirs.push(dir)
  return dir
}

function makeDbPath(): string {
  return path.join(makeTempDir(), 'jdc-context.db')
}

async function writeDatabase(dbPath: string, statements: string[]): Promise<void> {
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  for (const statement of statements) db.run(statement)
  writeFileSync(dbPath, Buffer.from(db.export()))
  db.close()
}

async function readPersistedFactIds(dbPath: string): Promise<string[]> {
  const SQL = await initSqlJs()
  const db = new SQL.Database(readFileSync(dbPath))
  try {
    return (db.exec('SELECT fact_id FROM context_facts ORDER BY fact_id ASC')[0]?.values ?? []).map((row) => String(row[0]))
  } finally {
    db.close()
  }
}

async function readUnassignedFactIds(dbPath: string): Promise<string[]> {
  const SQL = await initSqlJs()
  const db = new SQL.Database(readFileSync(dbPath))
  try {
    return (db.exec("SELECT fact_id FROM context_facts WHERE project_key IS NULL OR project_key = '' ORDER BY fact_id ASC")[0]?.values ?? []).map((row) => String(row[0]))
  } finally {
    db.close()
  }
}

function legacyMultiProjectStatements(projectA: string, projectB: string): string[] {
  return [
    `CREATE TABLE schema_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `INSERT INTO schema_meta(key, value) VALUES('context_schema_version', '1')`,
    `CREATE TABLE raw_evidence(
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
    `CREATE TABLE context_facts(
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
      expires_at INTEGER
    )`,
    `INSERT INTO raw_evidence(id, session_id, cwd, source_provider, kind, content, metadata_json, captured_at, hash)
     VALUES('legacy_evidence_a', 'session_a', '${projectA}', 'LegacyProvider', 'file', 'a', '{"file":"src/a.ts"}', 1000, 'hash_a')`,
    `INSERT INTO raw_evidence(id, session_id, cwd, source_provider, kind, content, metadata_json, captured_at, hash)
     VALUES('legacy_evidence_b', 'session_b', '${projectB}', 'LegacyProvider', 'file', 'b', '{"file":"src/b.ts"}', 1000, 'hash_b')`,
    `INSERT INTO context_facts(id, kind, scope, content, citations_json, confidence, freshness, source_provider, session_id, created_at, updated_at, expires_at)
     VALUES('legacy_fact_a', 'workflow_rule', 'project', 'Project A legacy fact.', '[{"id":"cit_a","type":"file","ref":"src/a.ts","hash":"hash_a"}]', 0.9, 'recent', 'LegacyProvider', 'session_a', 1000, 1000, NULL)`,
    `INSERT INTO context_facts(id, kind, scope, content, citations_json, confidence, freshness, source_provider, session_id, created_at, updated_at, expires_at)
     VALUES('legacy_fact_b', 'workflow_rule', 'project', 'Project B legacy fact.', '[{"id":"cit_b","type":"file","ref":"src/b.ts","hash":"hash_b"}]', 0.9, 'recent', 'LegacyProvider', 'session_b', 1000, 1000, NULL)`,
    `INSERT INTO context_facts(id, kind, scope, content, citations_json, confidence, freshness, source_provider, session_id, created_at, updated_at, expires_at)
     VALUES('legacy_fact_orphan', 'workflow_rule', 'project', 'Orphaned legacy fact stays quarantined.', '[{"id":"cit_orphan","type":"message","ref":"msg_orphan"}]', 0.9, 'recent', 'LegacyProvider', 'session_orphan', 1000, 1000, NULL)`,
  ]
}

function makeEvidence(overrides: Partial<RawEvidence> = {}): RawEvidence {
  return {
    id: 'evidence_1',
    sessionId: 'session_1',
    cwd: '/repo',
    sourceProvider: 'TestProvider',
    kind: 'file',
    content: 'export const ok = true',
    metadata: { file: 'src/file.ts' },
    capturedAt: 1_000,
    hash: 'hash_1',
    ...overrides,
  }
}

function makeFact(overrides: Partial<ContextFact> = {}): ContextFact {
  return {
    id: 'fact_1',
    kind: 'workflow_rule',
    scope: 'project',
    content: 'Durable facts require citations.',
    citations: [citation],
    confidence: 0.9,
    freshness: 'recent',
    sourceProvider: 'TestProvider',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function makeBundle(overrides: Partial<ContextBundle> = {}): ContextBundle {
  return {
    id: 'bundle_1',
    sessionId: 'session_1',
    requestHash: 'request_hash_1',
    createdAt: 1,
    sections: [],
    citations: [],
    diagnostics: [],
    budget: { maxTokens: 100, usedTokens: 0, droppedTokens: 0 },
    ...overrides,
  }
}

function makeDiagnostic(overrides: Partial<ContextDiagnostic> = {}): ContextDiagnostic {
  return {
    id: 'diag_1',
    level: 'info',
    source: 'TestProvider',
    message: 'diagnostic for visibility persistence',
    createdAt: 1_000,
    ...overrides,
  }
}

function makeHarvestJob(overrides: Partial<HarvestJob> = {}): HarvestJob {
  return {
    id: 'harvest_1',
    sessionId: 'session_1',
    runLoopId: 'run_1',
    status: 'skipped',
    candidate: { sessionId: 'session_1', runLoopId: 'run_1', userMessage: 'ok', assistantMessages: [], toolEvents: [], changedFiles: [], createdAt: 1_000 },
    decision: { action: 'skip', reason: 'no_new_fact' },
    modelBinding: { sessionId: 'session_1', providerProtocol: 'anthropic', modelId: 'model_1', modelConfig: { model: 'model_1', maxTokens: 100 } },
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  }
}

function pendingMemoryEnvelope(content: string) {
  return {
    schemaVersion: 1,
    distiller: 'MemoryCuratorDistiller',
    confidence: 0.92,
    citations: [{ id: 'cit_msg_1', type: 'message', ref: 'run_1:user' }],
    payload: { kind: 'workflow_hint', scope: 'project', content, confidence: 0.92 },
  }
}
