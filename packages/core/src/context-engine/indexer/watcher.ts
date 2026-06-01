// Filesystem watcher for incremental index updates. Wraps fs.watch with
// debouncing and ignore filtering. Recursive watch is supported on macOS and
// Windows natively; on Linux we degrade gracefully (best-effort).

import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { languageForPath } from '../parser/languages.js'
import { createIgnoreMatcher } from './scanner.js'

export interface WatcherOptions {
  /** Debounce window in ms before flushing a batch of changes. */
  debounceMs?: number
  /** Called with absolute paths that changed (created/modified). */
  onChange: (absPaths: string[]) => void
  /** Called with absolute paths that were removed. */
  onRemove: (absPaths: string[]) => void
}

export class ProjectWatcher {
  private cwd: string
  private watcher: FSWatcher | null = null
  private debounceMs: number
  private onChange: (absPaths: string[]) => void
  private onRemove: (absPaths: string[]) => void
  private pendingChange = new Set<string>()
  private pendingRemove = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  // Shared ignore rules (built-in dirs + .gitignore) so live updates skip the
  // same generated/ignored paths the initial full scan deliberately excluded.
  private isIgnored: (relPosixPath: string) => boolean

  constructor(cwd: string, opts: WatcherOptions) {
    this.cwd = cwd
    this.debounceMs = opts.debounceMs ?? 300
    this.onChange = opts.onChange
    this.onRemove = opts.onRemove
    this.isIgnored = createIgnoreMatcher(cwd)
  }

  start(): void {
    if (this.watcher) return
    try {
      this.watcher = watch(this.cwd, { recursive: true }, (_event, filename) => {
        if (!filename) return
        const rel = filename.toString().split(path.sep).join('/')
        if (this.isIgnored(rel)) return
        if (!languageForPath(rel)) return
        this.enqueue(path.join(this.cwd, rel))
      })
      this.watcher.on('error', (err) => {
        console.error('[context-engine] watcher error:', err)
      })
    } catch (err) {
      // Recursive watch unsupported (some Linux setups) — engine still works,
      // just without live updates.
      console.error('[context-engine] watch unavailable:', err)
    }
  }

  private enqueue(absPath: string): void {
    // We don't know from fs.watch whether it's add/change/unlink; resolve at
    // flush time by checking existence. Queue into change; the engine's
    // reindexFile handles "file gone → remove".
    this.pendingChange.add(absPath)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.debounceMs)
  }

  private flush(): void {
    this.timer = null
    const changed = Array.from(this.pendingChange)
    const removed = Array.from(this.pendingRemove)
    this.pendingChange.clear()
    this.pendingRemove.clear()
    if (changed.length) this.onChange(changed)
    if (removed.length) this.onRemove(removed)
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }
}
