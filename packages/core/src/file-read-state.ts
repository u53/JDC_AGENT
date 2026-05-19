import { statSync } from 'node:fs'

export interface FileReadEntry {
  /** mtime in ms when the file was last read */
  mtimeMs: number
  /** The offset used in the read (0 if full file) */
  offset: number
  /** The limit used in the read (Infinity if full file) */
  limit: number
  /** Whether this entry came from a Read tool (vs Edit/Write which invalidate) */
  fromRead: boolean
}

/**
 * Tracks which files have been read in the current session, along with their
 * mtime at read time. When the model re-reads the same file with the same
 * range and the file hasn't changed on disk, we return a stub message instead
 * of the full content — saving significant tokens in long conversations.
 *
 * Claude Code reports ~18% of Read calls are same-file collisions.
 */
export class FileReadStateCache {
  private cache = new Map<string, FileReadEntry>()
  private maxEntries: number

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries
  }

  /**
   * Record that a file was read. Call after a successful file_read.
   */
  recordRead(filePath: string, offset: number, limit: number): void {
    try {
      const stat = statSync(filePath)
      this.cache.set(filePath, {
        mtimeMs: stat.mtimeMs,
        offset,
        limit,
        fromRead: true,
      })
      this.evictIfNeeded()
    } catch {
      // File might not exist or be inaccessible — skip caching
    }
  }

  /**
   * Invalidate a file's cache entry. Call after file_edit or file_write
   * modifies the file, so subsequent reads won't be deduped against stale state.
   */
  invalidate(filePath: string): void {
    this.cache.delete(filePath)
  }

  /**
   * Check if a read can be deduped. Returns true if:
   * 1. We've read this file before with the same range
   * 2. The file's mtime hasn't changed since our last read
   */
  canDedup(filePath: string, offset: number, limit: number): boolean {
    const entry = this.cache.get(filePath)
    if (!entry || !entry.fromRead) return false

    // Range must match
    if (entry.offset !== offset || entry.limit !== limit) return false

    // Check if file has been modified since we last read it
    try {
      const stat = statSync(filePath)
      return stat.mtimeMs === entry.mtimeMs
    } catch {
      return false
    }
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }

  private evictIfNeeded(): void {
    if (this.cache.size <= this.maxEntries) return
    // Evict oldest entries (first inserted)
    const keys = this.cache.keys()
    const toDelete = this.cache.size - this.maxEntries
    for (let i = 0; i < toDelete; i++) {
      const key = keys.next().value
      if (key) this.cache.delete(key)
    }
  }
}
