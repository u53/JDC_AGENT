// Snapshot persistence for the context engine. Stores the full index as JSON
// under .jdcagnet/context-engine/index.json so a restart can load instantly and
// only revalidate changed files instead of rebuilding from scratch.

import { readFile, writeFile, mkdir, appendFile, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { StoreSnapshot } from '../graph/store.js'

// Bump when the on-disk shape or parser output changes in an incompatible way,
// forcing a full rebuild instead of loading a stale snapshot.
export const SNAPSHOT_VERSION = 1

export interface PersistedSnapshot {
  version: number
  engineCwd: string
  savedAt: number
  store: StoreSnapshot
}

function snapshotDir(cwd: string): string {
  return path.join(cwd, '.jdcagnet', 'context-engine')
}

function snapshotPath(cwd: string): string {
  return path.join(snapshotDir(cwd), 'index.json')
}

/** Load a snapshot if present and version-compatible. Returns null otherwise. */
export async function loadSnapshot(cwd: string): Promise<StoreSnapshot | null> {
  try {
    const raw = await readFile(snapshotPath(cwd), 'utf-8')
    const parsed = JSON.parse(raw) as PersistedSnapshot
    if (parsed.version !== SNAPSHOT_VERSION) return null
    if (!parsed.store || !Array.isArray(parsed.store.files)) return null
    return parsed.store
  } catch {
    // Missing / unreadable / malformed → treat as no snapshot.
    return null
  }
}

/** Persist a snapshot atomically (write temp then rename). */
export async function saveSnapshot(cwd: string, store: StoreSnapshot): Promise<void> {
  const dir = snapshotDir(cwd)
  await mkdir(dir, { recursive: true })
  await ensureSnapshotIgnored(cwd)
  const payload: PersistedSnapshot = {
    version: SNAPSHOT_VERSION,
    engineCwd: cwd,
    savedAt: Date.now(),
    store,
  }
  const target = snapshotPath(cwd)
  const tmp = `${target}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(payload), 'utf-8')
  // Rename is atomic on the same filesystem — avoids torn reads.
  await rename(tmp, target)
}

// Per-cwd guard so the debounced save path doesn't re-read/append .gitignore on
// every flush — we only need to ensure the entry once per engine lifetime.
const gitignoreEnsured = new Set<string>()

// The whole .jdcagnet/ directory holds tool-generated artifacts (index cache,
// plans, rules, etc.), so ignore it wholesale rather than just the snapshot dir.
const IGNORE_ENTRY = '.jdcagnet/'

/**
 * Ensure the .jdcagnet/ directory is gitignored so opening the app on a user's
 * repo doesn't litter it with untracked tool files. Only acts when the project
 * is a git repo; non-critical, never throws.
 */
async function ensureSnapshotIgnored(cwd: string): Promise<void> {
  if (gitignoreEnsured.has(cwd)) return
  gitignoreEnsured.add(cwd)
  try {
    // Only manage .gitignore inside an actual git repo.
    if (!existsSync(path.join(cwd, '.git'))) return
    const gitignorePath = path.join(cwd, '.gitignore')
    if (existsSync(gitignorePath)) {
      const content = await readFile(gitignorePath, 'utf-8')
      const already = content
        .split('\n')
        .map((l) => l.trim())
        .some((l) => l === '.jdcagnet' || l === '.jdcagnet/')
      if (already) return
      const suffix = content.length > 0 && !content.endsWith('\n') ? '\n' : ''
      await appendFile(gitignorePath, `${suffix}${IGNORE_ENTRY}\n`)
    } else {
      await writeFile(gitignorePath, `${IGNORE_ENTRY}\n`, 'utf-8')
    }
  } catch {
    // Non-critical: never block snapshot persistence on gitignore bookkeeping.
  }
}
