// Query facade for tools. Returns plain data shapes aligned with the former
// codegraph_* tool outputs so the model's habits transfer directly.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ContextEngine } from './engine.js'
import { CallGraph } from './graph/call-graph.js'
import { hotFiles, workingChanges, type GitHotFile, type GitChange } from './git/git-context.js'
import type { SymbolNode } from './types.js'

export interface SymbolLocation {
  name: string
  kind: string
  file: string
  line: number
  signature?: string
}

export interface NodeDetail extends SymbolLocation {
  endLine: number
  callers: SymbolLocation[]
  callees: SymbolLocation[]
  code?: string
}

export interface ContextResult {
  query: string
  entryPoints: SymbolLocation[]
  related: SymbolLocation[]
  keyCode: { file: string; symbol: string; code: string }[]
  gitHotFiles?: GitHotFile[]
  gitChanges?: GitChange[]
}

export class EngineQuery {
  private engine: ContextEngine
  private graph: CallGraph

  constructor(engine: ContextEngine) {
    this.engine = engine
    this.graph = new CallGraph(engine.getStore())
  }

  search(query: string, limit = 10): SymbolLocation[] {
    return this.engine.searchSymbols(query, limit).map(toLocation)
  }

  /** Resolve a name to one symbol — prefers exact, then functionish. */
  private resolveOne(name: string): SymbolNode | null {
    const exact = this.engine.symbolsByName(name)
    if (exact.length > 0) {
      const fn = exact.find((s) => s.kind === 'function' || s.kind === 'method')
      return fn ?? exact[0]
    }
    const fuzzy = this.engine.searchSymbols(name, 1)
    return fuzzy[0] ?? null
  }

  async node(name: string, includeCode = false): Promise<NodeDetail | null> {
    const sym = this.resolveOne(name)
    if (!sym) return null
    const detail: NodeDetail = {
      ...toLocation(sym),
      endLine: sym.endLine,
      callers: this.graph.callers(sym.id).map(toLocation),
      callees: this.graph.callees(sym.id).map(toLocation),
    }
    if (includeCode) {
      detail.code = await this.readSymbolSource(sym)
    }
    return detail
  }

  callers(name: string): SymbolLocation[] {
    const sym = this.resolveOne(name)
    if (!sym) return []
    return this.graph.callers(sym.id).map(toLocation)
  }

  callees(name: string): SymbolLocation[] {
    const sym = this.resolveOne(name)
    if (!sym) return []
    return this.graph.callees(sym.id).map(toLocation)
  }

  impact(name: string, depth = 2): SymbolLocation[] {
    const sym = this.resolveOne(name)
    if (!sym) return []
    return this.graph.impact(sym.id, depth).map(toLocation)
  }

  trace(from: string, to: string): SymbolLocation[] | null {
    const a = this.resolveOne(from)
    const b = this.resolveOne(to)
    if (!a || !b) return null
    const path = this.graph.trace(a.id, b.id)
    return path ? path.map(toLocation) : null
  }

  async explore(names: string[]): Promise<{ file: string; symbol: string; code: string }[]> {
    const out: { file: string; symbol: string; code: string }[] = []
    for (const name of names) {
      const sym = this.resolveOne(name)
      if (!sym) continue
      const code = await this.readSymbolSource(sym)
      if (code) out.push({ file: sym.filePath, symbol: sym.name, code })
    }
    return out
  }

  /** Composite entry point: search + node + callers/callees for top match. */
  async context(task: string, maxNodes = 20, includeCode = true): Promise<ContextResult> {
    const terms = task.split(/[^A-Za-z0-9_]+/).filter((t) => t.length >= 3)
    const seen = new Set<string>()
    const entry: SymbolNode[] = []
    for (const term of terms) {
      for (const s of this.engine.searchSymbols(term, 5)) {
        if (!seen.has(s.id)) {
          seen.add(s.id)
          entry.push(s)
        }
      }
      if (entry.length >= maxNodes) break
    }
    const related: SymbolNode[] = []
    const relSeen = new Set(entry.map((s) => s.id))
    for (const s of entry.slice(0, 5)) {
      for (const c of [...this.graph.callees(s.id), ...this.graph.callers(s.id)]) {
        if (!relSeen.has(c.id)) {
          relSeen.add(c.id)
          related.push(c)
        }
      }
    }
    const keyCode: { file: string; symbol: string; code: string }[] = []
    if (includeCode) {
      for (const s of entry.slice(0, 5)) {
        const code = await this.readSymbolSource(s)
        if (code) keyCode.push({ file: s.filePath, symbol: s.name, code })
      }
    }
    // Git signals — best effort, never fail the query.
    const [gitHotFiles, gitChanges] = await Promise.all([
      hotFiles(this.engine.cwd, 100, 10).catch(() => [] as GitHotFile[]),
      workingChanges(this.engine.cwd).catch(() => [] as GitChange[]),
    ])
    return {
      query: task,
      entryPoints: entry.slice(0, maxNodes).map(toLocation),
      related: related.slice(0, maxNodes).map(toLocation),
      keyCode,
      gitHotFiles,
      gitChanges,
    }
  }

  private async readSymbolSource(sym: SymbolNode): Promise<string | undefined> {
    try {
      const abs = path.join(this.engine.cwd, sym.filePath)
      const content = await readFile(abs, 'utf-8')
      const lines = content.split('\n')
      return lines.slice(sym.startLine - 1, sym.endLine).join('\n')
    } catch {
      return undefined
    }
  }
}

function toLocation(s: SymbolNode): SymbolLocation {
  return {
    name: s.name,
    kind: s.kind,
    file: s.filePath,
    line: s.line,
    signature: s.signature,
  }
}
