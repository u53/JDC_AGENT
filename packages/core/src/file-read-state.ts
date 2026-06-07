import { createHash } from 'node:crypto'
import { statSync, readFileSync } from 'node:fs'

export type FreshReadFailureReason = 'not_read' | 'stale' | 'missing' | 'range_not_read'

export interface FreshReadCheckOptions {
  requiredText?: string
  requireFullFile?: boolean
}

export interface MutationReplacement {
  oldText: string
  newText: string
  replaceAll?: boolean
}

export interface MutationSnapshotOptions {
  replacements?: MutationReplacement[]
}

export type FreshReadCheck =
  | { ok: true; entry: FileReadEntry; reason?: never; message?: never }
  | { ok: false; reason: FreshReadFailureReason; message: string; entry?: FileReadEntry }

export interface FileReadEntry {
  /** mtime in ms when the file was last read */
  mtimeMs: number
  /** file size in bytes when the file was last read */
  sizeBytes: number
  /** The offset used in the read (0 if full file) */
  offset: number
  /** The limit used in the read (Infinity if full file) */
  limit: number
  /** Total number of lines in the file at read time */
  totalLines: number
  /** Whether this read covered the complete file */
  fullFile: boolean
  /** Hash of the returned text range */
  contentHash: string
  /** Text returned to the model for this range */
  content: string
  /** Whether this entry came from a Read tool */
  fromRead: boolean
}

/**
 * Tracks which file ranges have been read in the current session. The same
 * cache serves two purposes: read de-duplication and mutation safety checks.
 */
export class FileReadStateCache {
  private cache = new Map<string, FileReadEntry[]>()
  private entryOrder: Array<{ filePath: string; entry: FileReadEntry }> = []
  private maxEntries: number

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries
  }

  /**
   * Record that a file was read. Call after a successful file_read.
   */
  recordRead(filePath: string, offset: number, limit: number, totalLines = Number.POSITIVE_INFINITY, content = ''): void {
    this.recordEntry(filePath, offset, limit, totalLines, content, true)
  }

  /**
   * Record the current file content after a successful mutation. Mutation
   * snapshots inherit the ranges that were already visible; they do not expand
   * partial reads into full-file coverage.
   */
  recordMutationSnapshot(filePath: string, content: string, options: MutationSnapshotOptions = {}): void {
    const totalLines = content.split('\n').length
    const existingEntries = [...(this.cache.get(filePath) ?? [])]
    if (existingEntries.length === 0) {
      this.recordEntry(filePath, 0, totalLines, totalLines, content, false)
      return
    }

    const fullFileEntry = existingEntries.find((entry) => entry.fullFile)
    if (fullFileEntry) {
      this.recordEntry(filePath, 0, totalLines, totalLines, content, false)
      return
    }

    const seenContent = new Set<string>()
    for (let index = existingEntries.length - 1; index >= 0; index -= 1) {
      const entry = existingEntries[index]
      const updatedEntryContent = applyReplacements(entry.content, options.replacements ?? [])
      if (!updatedEntryContent || seenContent.has(updatedEntryContent)) continue
      seenContent.add(updatedEntryContent)

      const offset = uniqueLineOffset(content, updatedEntryContent)
      if (offset === undefined) continue
      const limit = updatedEntryContent.split('\n').length
      this.recordEntry(filePath, offset, limit, totalLines, updatedEntryContent, false)
    }
  }

  private recordEntry(
    filePath: string,
    offset: number,
    limit: number,
    totalLines: number,
    content: string,
    fromRead: boolean
  ): void {
    try {
      const stat = statSync(filePath)
      const effectiveLimit = limit === Infinity ? totalLines : limit
      const fullFile = offset <= 0 && offset + effectiveLimit >= totalLines
      const entry: FileReadEntry = {
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
        offset,
        limit,
        totalLines,
        fullFile,
        contentHash: hashText(content),
        content,
        fromRead,
      }
      const entries = this.cache.get(filePath) ?? []
      entries.push(entry)
      this.cache.set(filePath, entries)
      this.entryOrder.push({ filePath, entry })
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
    this.entryOrder = this.entryOrder.filter((item) => item.filePath !== filePath)
  }

  /**
   * Check if a read can be deduped. Returns true if:
   * 1. We've read this file before with the same range
   * 2. At least one matching read entry is still fresh
   */
  canDedup(filePath: string, offset: number, limit: number): boolean {
    const entries = this.cache.get(filePath) ?? []

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (entry.fromRead && entry.offset === offset && entry.limit === limit && this.isEntryFresh(filePath, entry)) {
        return true
      }
    }

    return false
  }

  checkFreshRead(filePath: string, options: FreshReadCheckOptions = {}): FreshReadCheck {
    const entries = this.cache.get(filePath) ?? []
    if (entries.length === 0) {
      return {
        ok: false,
        reason: 'not_read',
        message: `${filePath} has not been read in this session. Missing edit anchor: ${this.previewRequiredText(options.requiredText)}.`,
      }
    }

    const freshEntries = entries.filter((entry) => this.isEntryFresh(filePath, entry))
    if (freshEntries.length === 0) {
      const reason = this.missingFile(filePath) ? 'missing' : 'stale'
      const message =
        reason === 'missing'
          ? `${filePath} was read but is now missing. Restore or recreate it before editing.`
          : `${filePath} changed after it was read. Read it again before editing.`
      return { ok: false, reason, message, entry: entries.at(-1) }
    }

    if (options.requireFullFile) {
      const fullFileEntry = freshEntries.find((entry) => entry.fullFile)
      if (!fullFileEntry) {
        return {
          ok: false,
          reason: 'range_not_read',
          message: `${filePath} was read only in ranges. Read the entire file before overwriting it. Read ranges: ${this.describeEntries(freshEntries)}.`,
          entry: freshEntries.at(-1),
        }
      }
      return { ok: true, entry: fullFileEntry }
    }

    const requiredText = options.requiredText
    if (!requiredText) return { ok: true, entry: freshEntries.at(-1)! }

    const matching = freshEntries.find((entry) => entry.fullFile || entry.content.includes(requiredText))
    if (!matching) {
      return {
        ok: false,
        reason: 'range_not_read',
        message: `${filePath} was read only in ranges that do not include the edit anchor. Read the relevant range before editing. Read ranges: ${this.describeEntries(freshEntries)}. Missing edit anchor: ${this.previewRequiredText(requiredText)}.`,
        entry: freshEntries.at(-1),
      }
    }

    return { ok: true, entry: matching }
  }

  clear(): void {
    this.cache.clear()
    this.entryOrder = []
  }

  get size(): number {
    return this.entryOrder.length
  }

  private describeEntries(entries: FileReadEntry[]): string {
    if (entries.length === 0) return 'none'
    return entries
      .map((entry) => {
        const start = entry.offset + 1
        const effectiveLimit = entry.limit === Infinity ? entry.totalLines : entry.limit
        const end = Math.min(entry.offset + effectiveLimit, entry.totalLines)
        const source = entry.fromRead ? 'Read' : 'mutation snapshot'
        return `${source} lines ${start}-${end}${entry.fullFile ? ' (full file)' : ''}`
      })
      .join('; ')
  }

  private previewRequiredText(requiredText?: string): string {
    if (!requiredText) return '(none)'
    const normalized = requiredText.replace(/\s+/g, ' ').trim()
    return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized
  }

  private isEntryFresh(filePath: string, entry: FileReadEntry): boolean {
    try {
      const stat = statSync(filePath)
      if (stat.mtimeMs !== entry.mtimeMs || stat.size !== entry.sizeBytes) return false
      return this.currentContentMatches(filePath, entry)
    } catch {
      return false
    }
  }

  private currentContentMatches(filePath: string, entry: FileReadEntry): boolean {
    const content = readFileSync(filePath, 'utf-8')
    if (entry.fullFile && hashText(content) === entry.contentHash) return true

    const lines = content.split('\n')
    const effectiveLimit = entry.fullFile ? entry.totalLines : entry.limit === Infinity ? entry.totalLines : entry.limit
    const currentRange = lines.slice(entry.offset, entry.offset + effectiveLimit).join('\n')
    return hashText(currentRange) === entry.contentHash
  }

  private missingFile(filePath: string): boolean {
    try {
      statSync(filePath)
      return false
    } catch {
      return true
    }
  }

  private evictIfNeeded(): void {
    while (this.entryOrder.length > this.maxEntries) {
      const oldest = this.entryOrder.shift()
      if (!oldest) return

      const entries = this.cache.get(oldest.filePath)
      if (!entries) continue

      const index = entries.indexOf(oldest.entry)
      if (index >= 0) entries.splice(index, 1)

      if (entries.length === 0) {
        this.cache.delete(oldest.filePath)
      } else {
        this.cache.set(oldest.filePath, entries)
      }
    }
  }
}

function hashText(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}

function applyReplacements(text: string, replacements: MutationReplacement[]): string {
  let updated = text
  for (const replacement of replacements) {
    if (!updated.includes(replacement.oldText)) continue
    updated = replacement.replaceAll
      ? updated.split(replacement.oldText).join(replacement.newText)
      : updated.replace(replacement.oldText, replacement.newText)
  }
  return updated
}

function uniqueLineOffset(content: string, snippet: string): number | undefined {
  const contentLines = content.split('\n')
  const snippetLines = snippet.split('\n')
  let matchOffset: number | undefined

  for (let offset = 0; offset <= contentLines.length - snippetLines.length; offset += 1) {
    const candidate = contentLines.slice(offset, offset + snippetLines.length).join('\n')
    if (candidate !== snippet) continue
    if (matchOffset !== undefined) return undefined
    matchOffset = offset
  }

  return matchOffset
}
