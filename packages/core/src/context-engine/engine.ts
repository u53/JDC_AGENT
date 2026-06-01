// ContextEngine: orchestrates scanning, parsing, querying, and persistence.
// On index() it loads a disk snapshot (if any) then revalidates by file hash,
// reparsing only changed/new files and dropping deleted ones — a full rebuild
// happens only when no valid snapshot exists.

import path from 'node:path'
import { IndexStore } from './graph/store.js'
import { scanProject, readFileSafe, toPosix } from './indexer/scanner.js'
import { parseFile, hashContent } from './parser/parser.js'
import { languageForPath } from './parser/languages.js'
import { ProjectWatcher } from './indexer/watcher.js'
import { loadSnapshot, saveSnapshot } from './indexer/snapshot.js'
import type { SymbolNode, EngineStats } from './types.js'

export interface IndexProgress {
  scanned: number
  total: number
  /** Whether this run loaded a prior snapshot (revalidate) vs full rebuild. */
  fromSnapshot?: boolean
}

export class ContextEngine {
  readonly cwd: string
  private store = new IndexStore()
  private indexed = false
  private indexing: Promise<void> | null = null
  private watcher: ProjectWatcher | null = null
  private loadedFromSnapshot = false
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private dirty = false

  constructor(cwd: string) {
    this.cwd = cwd
  }

  isIndexed(): boolean {
    return this.indexed
  }

  /** True if the current index was seeded from a persisted snapshot. */
  wasLoadedFromSnapshot(): boolean {
    return this.loadedFromSnapshot
  }

  /** Build the full index. Idempotent — concurrent calls share one run. */
  async index(onProgress?: (p: IndexProgress) => void): Promise<void> {
    if (this.indexing) return this.indexing
    this.indexing = this.runIndex(onProgress).finally(() => {
      this.indexing = null
    })
    return this.indexing
  }

  private async runIndex(onProgress?: (p: IndexProgress) => void): Promise<void> {
    const snapshot = await loadSnapshot(this.cwd)
    if (snapshot && snapshot.files.length > 0) {
      this.store.load(snapshot)
      this.loadedFromSnapshot = true
      // NOTE: do NOT set `indexed = true` here. The store still holds the
      // pre-revalidation snapshot, which may reference files that changed or
      // were deleted while the app was closed. Staying non-indexed forces any
      // concurrent tool call (which guards on isIndexed()) to await this same
      // in-flight run via `this.indexing`, so it never queries stale symbols.
      await this.revalidate(onProgress)
    } else {
      await this.fullScan(onProgress)
    }
    this.indexed = true
    this.scheduleSave()
  }

  /** Full scan from scratch — parses every indexable file. */
  private async fullScan(onProgress?: (p: IndexProgress) => void): Promise<void> {
    const files = await scanProject(this.cwd)
    let scanned = 0
    const CONCURRENCY = 8
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < files.length) {
        const i = cursor++
        const f = files[i]
        const content = await readFileSafe(f.absPath)
        if (content !== null) {
          const idx = await parseFile(f.relPath, f.languageId, content)
          if (idx) this.store.upsertFile(idx)
        }
        scanned++
        if (onProgress) onProgress({ scanned, total: files.length })
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  }

  /**
   * Incremental revalidation against a loaded snapshot: reparse files whose
   * hash changed or that are new, and drop files that no longer exist.
   */
  private async revalidate(onProgress?: (p: IndexProgress) => void): Promise<void> {
    const files = await scanProject(this.cwd)
    const known = this.store.fileHashes()
    const seen = new Set<string>()
    let scanned = 0
    const CONCURRENCY = 8
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < files.length) {
        const i = cursor++
        const f = files[i]
        seen.add(f.relPath)
        const content = await readFileSafe(f.absPath)
        if (content !== null) {
          const prevHash = known.get(f.relPath)
          if (prevHash !== hashContent(content)) {
            const idx = await parseFile(f.relPath, f.languageId, content)
            if (idx) this.store.upsertFile(idx)
          }
        }
        scanned++
        if (onProgress) onProgress({ scanned, total: files.length, fromSnapshot: true })
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    // Drop files that vanished since the snapshot was written.
    for (const relPath of known.keys()) {
      if (!seen.has(relPath)) this.store.removeFile(relPath)
    }
  }


  /**
   * Begin watching the project for changes and incrementally update the index.
   * Safe to call once after the initial index() completes. No-op if already
   * watching. Returns immediately; updates happen in the background.
   */
  startWatching(): void {
    if (this.watcher) return
    this.watcher = new ProjectWatcher(this.cwd, {
      debounceMs: 300,
      onChange: (paths) => {
        void this.handleChanges(paths)
      },
      onRemove: (paths) => {
        for (const p of paths) this.removeFile(p)
      },
    })
    this.watcher.start()
  }

  stopWatching(): void {
    this.watcher?.stop()
    this.watcher = null
    // Persist any pending changes immediately on shutdown.
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    void this.flushSave()
  }

  private async handleChanges(absPaths: string[]): Promise<void> {
    for (const abs of absPaths) {
      try {
        await this.reindexFile(abs)
      } catch (err) {
        console.error('[context-engine] reindex failed for', abs, err)
      }
    }
  }

  /** Re-index a single file (used by incremental updates). */
  async reindexFile(absPath: string): Promise<void> {
    const relPath = toPosix(path.relative(this.cwd, absPath))
    const languageId = languageForPath(relPath)
    if (!languageId) return
    const content = await readFileSafe(absPath)
    if (content === null) {
      this.store.removeFile(relPath)
      this.scheduleSave()
      return
    }
    if (this.store.fileHash(relPath) === hashContent(content)) return
    const idx = await parseFile(relPath, languageId, content)
    if (idx) {
      this.store.upsertFile(idx)
      this.scheduleSave()
    }
  }

  removeFile(absPath: string): void {
    const relPath = toPosix(path.relative(this.cwd, absPath))
    this.store.removeFile(relPath)
    this.scheduleSave()
  }

  /** Debounced snapshot write — coalesces bursts of edits into one disk write. */
  private scheduleSave(): void {
    this.dirty = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      void this.flushSave()
    }, 2000)
  }

  private async flushSave(): Promise<void> {
    this.saveTimer = null
    if (!this.dirty) return
    this.dirty = false
    try {
      await saveSnapshot(this.cwd, this.store.serialize())
    } catch (err) {
      console.error('[context-engine] snapshot save failed:', err)
    }
  }


  // ---- Query surface (consumed by query.ts / tools) ----

  searchSymbols(query: string, limit = 20): SymbolNode[] {
    return this.store.searchSymbols(query, limit)
  }

  symbolsByName(name: string): SymbolNode[] {
    return this.store.symbolsByName(name)
  }

  getStore(): IndexStore {
    return this.store
  }

  stats(): EngineStats {
    return this.store.stats()
  }
}
