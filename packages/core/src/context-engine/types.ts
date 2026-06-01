// Core data model for the JDC Context Engine.
// We store only symbol metadata (name/kind/location/edges), never source text —
// source is read on demand from disk. This keeps memory bounded on large repos.

export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable'
  | 'constant'
  | 'struct'
  | 'module'

/** A code symbol definition discovered by Tree-sitter tag queries. */
export interface SymbolNode {
  /** Stable id: `${relPath}#${name}@${startLine}` */
  id: string
  name: string
  kind: SymbolKind
  /** Project-relative POSIX path of the file the symbol is defined in. */
  filePath: string
  /** 1-based line of the definition's name token. */
  line: number
  /** 1-based column of the definition's name token. */
  column: number
  /** 1-based line where the enclosing definition body starts. */
  startLine: number
  /** 1-based line where the enclosing definition body ends. */
  endLine: number
  /** Signature/first line of the definition, for display. */
  signature?: string
}

/** A reference (call / usage) of an identifier at a position. */
export interface ReferenceNode {
  /** The identifier name being referenced. */
  name: string
  /** Project-relative POSIX path of the file containing the reference. */
  filePath: string
  /** 1-based line. */
  line: number
  /** 1-based column. */
  column: number
  /** Reference flavor — call vs generic usage. */
  kind: 'call' | 'usage'
  /** id of the enclosing symbol definition this reference sits inside, if any. */
  enclosingSymbolId?: string
}

/** An import binding: local name → resolved/declared module source. */
export interface ImportBinding {
  /** Local identifier introduced by the import. */
  localName: string
  /** Raw module specifier, e.g. './bar' or 'react'. */
  source: string
  filePath: string
  line: number
}

/** Everything extracted from a single parsed file. */
export interface FileIndex {
  filePath: string
  language: string
  /** Hash of file content at index time, to skip unchanged files. */
  hash: string
  symbols: SymbolNode[]
  references: ReferenceNode[]
  imports: ImportBinding[]
}

/** A directed call-graph edge: caller symbol → callee symbol. */
export interface CallEdge {
  fromId: string
  toId: string
  /** Where the call site is. */
  filePath: string
  line: number
  /** Resolution confidence — name resolution is heuristic, not type-checked. */
  confidence: 'high' | 'medium' | 'low'
}

export interface EngineStats {
  files: number
  symbols: number
  references: number
  edges: number
  lastIndexed: number
}
