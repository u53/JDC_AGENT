// In-memory index store. Bucketed by file so incremental updates can cleanly
// drop and replace a single file's contribution.

import type {
  FileIndex,
  SymbolNode,
  ReferenceNode,
  ImportBinding,
  EngineStats,
} from '../types.js'

export class IndexStore {
  private files = new Map<string, FileIndex>()
  // name → symbol ids, for fast lookup by identifier.
  private nameToSymbolIds = new Map<string, Set<string>>()
  private symbolsById = new Map<string, SymbolNode>()
  private lastIndexed = 0

  /** Replace (or add) a file's index, cleaning any prior contribution. */
  upsertFile(index: FileIndex): void {
    this.removeFile(index.filePath)
    this.files.set(index.filePath, index)
    for (const sym of index.symbols) {
      this.symbolsById.set(sym.id, sym)
      let set = this.nameToSymbolIds.get(sym.name)
      if (!set) {
        set = new Set()
        this.nameToSymbolIds.set(sym.name, set)
      }
      set.add(sym.id)
    }
    this.lastIndexed = Date.now()
  }

  /** Drop a file and all of its symbols from the index. */
  removeFile(filePath: string): void {
    const existing = this.files.get(filePath)
    if (!existing) return
    for (const sym of existing.symbols) {
      this.symbolsById.delete(sym.id)
      const set = this.nameToSymbolIds.get(sym.name)
      if (set) {
        set.delete(sym.id)
        if (set.size === 0) this.nameToSymbolIds.delete(sym.name)
      }
    }
    this.files.delete(filePath)
  }

  hasFile(filePath: string): boolean {
    return this.files.has(filePath)
  }

  fileHash(filePath: string): string | null {
    return this.files.get(filePath)?.hash ?? null
  }

  getFile(filePath: string): FileIndex | undefined {
    return this.files.get(filePath)
  }

  allFiles(): FileIndex[] {
    return Array.from(this.files.values())
  }

  getSymbolById(id: string): SymbolNode | undefined {
    return this.symbolsById.get(id)
  }

  /** All symbols matching an exact name. */
  symbolsByName(name: string): SymbolNode[] {
    const ids = this.nameToSymbolIds.get(name)
    if (!ids) return []
    const out: SymbolNode[] = []
    for (const id of ids) {
      const s = this.symbolsById.get(id)
      if (s) out.push(s)
    }
    return out
  }

  /** Fuzzy/substring search over symbol names (case-insensitive). */
  searchSymbols(query: string, limit = 20): SymbolNode[] {
    const q = query.toLowerCase()
    const exact: SymbolNode[] = []
    const prefix: SymbolNode[] = []
    const sub: SymbolNode[] = []
    for (const s of this.symbolsById.values()) {
      const n = s.name.toLowerCase()
      if (n === q) exact.push(s)
      else if (n.startsWith(q)) prefix.push(s)
      else if (n.includes(q)) sub.push(s)
    }
    return [...exact, ...prefix, ...sub].slice(0, limit)
  }

  allReferences(): ReferenceNode[] {
    const out: ReferenceNode[] = []
    for (const f of this.files.values()) out.push(...f.references)
    return out
  }

  importsForFile(filePath: string): ImportBinding[] {
    return this.files.get(filePath)?.imports ?? []
  }

  stats(): EngineStats {
    let symbols = 0
    let references = 0
    for (const f of this.files.values()) {
      symbols += f.symbols.length
      references += f.references.length
    }
    return {
      files: this.files.size,
      symbols,
      references,
      edges: 0,
      lastIndexed: this.lastIndexed,
    }
  }

  clear(): void {
    this.files.clear()
    this.nameToSymbolIds.clear()
    this.symbolsById.clear()
    this.lastIndexed = 0
  }

  /** Map of filePath → content hash, for incremental revalidation. */
  fileHashes(): Map<string, string> {
    const out = new Map<string, string>()
    for (const f of this.files.values()) out.set(f.filePath, f.hash)
    return out
  }

  /** Full snapshot: every file's complete index. Replayable via load(). */
  serialize(): StoreSnapshot {
    return {
      files: Array.from(this.files.values()),
      lastIndexed: this.lastIndexed,
    }
  }

  /** Replace all state from a snapshot, rebuilding lookup indices. */
  load(snapshot: StoreSnapshot): void {
    this.clear()
    for (const file of snapshot.files) {
      this.upsertFile(file)
    }
    this.lastIndexed = snapshot.lastIndexed || Date.now()
  }
}

/** Serialized form of the index store. */
export interface StoreSnapshot {
  files: FileIndex[]
  lastIndexed: number
}

