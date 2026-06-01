// Call-graph algorithms: callers, callees, impact (reverse BFS), trace (path).
// Built lazily from the store and cached until the store changes.

import type { SymbolNode } from '../types.js'
import type { IndexStore } from './store.js'
import { buildCallGraph, type ResolvedEdges } from './reference-resolver.js'

export interface TracePathStep {
  symbol: SymbolNode
  callLine?: number
}

export class CallGraph {
  private store: IndexStore
  private resolved: ResolvedEdges | null = null
  private builtAt = -1

  constructor(store: IndexStore) {
    this.store = store
  }

  /** Rebuild edges if the store changed since last build. */
  private ensure(): ResolvedEdges {
    const stamp = this.store.stats().lastIndexed
    if (!this.resolved || this.builtAt !== stamp) {
      this.resolved = buildCallGraph(this.store)
      this.builtAt = stamp
    }
    return this.resolved
  }

  /** Direct callers of a symbol id. */
  callers(symbolId: string): SymbolNode[] {
    const r = this.ensure()
    return idsToSymbols(this.store, r.callersOf.get(symbolId))
  }

  /** Direct callees of a symbol id. */
  callees(symbolId: string): SymbolNode[] {
    const r = this.ensure()
    return idsToSymbols(this.store, r.calleesOf.get(symbolId))
  }

  /**
   * Impact radius: everything (transitively) that calls the given symbol, up to
   * `depth` hops. This is what "what breaks if I change X" needs.
   */
  impact(symbolId: string, depth = 2): SymbolNode[] {
    const r = this.ensure()
    const seen = new Set<string>([symbolId])
    let frontier = [symbolId]
    const result = new Set<string>()
    for (let d = 0; d < depth; d++) {
      const next: string[] = []
      for (const id of frontier) {
        for (const caller of r.callersOf.get(id) ?? []) {
          if (!seen.has(caller)) {
            seen.add(caller)
            result.add(caller)
            next.push(caller)
          }
        }
      }
      frontier = next
      if (frontier.length === 0) break
    }
    return idsToSymbols(this.store, result)
  }

  /**
   * Find a call path from `fromId` to `toId` (BFS, shortest hop count).
   * Returns the chain of symbols or null if unreachable in the static graph.
   */
  trace(fromId: string, toId: string, maxDepth = 8): SymbolNode[] | null {
    const r = this.ensure()
    if (fromId === toId) {
      const s = this.store.getSymbolById(fromId)
      return s ? [s] : null
    }
    const prev = new Map<string, string>()
    const seen = new Set<string>([fromId])
    let frontier = [fromId]
    let found = false
    for (let d = 0; d < maxDepth && !found; d++) {
      const next: string[] = []
      for (const id of frontier) {
        for (const callee of r.calleesOf.get(id) ?? []) {
          if (seen.has(callee)) continue
          seen.add(callee)
          prev.set(callee, id)
          if (callee === toId) {
            found = true
            break
          }
          next.push(callee)
        }
        if (found) break
      }
      frontier = next
    }
    if (!found) return null
    // Reconstruct path.
    const path: string[] = [toId]
    let cur = toId
    while (cur !== fromId) {
      const p = prev.get(cur)
      if (!p) return null
      path.unshift(p)
      cur = p
    }
    return idsToSymbols(this.store, new Set(path), path)
  }

  edgeCount(): number {
    return this.ensure().edges.length
  }
}

function idsToSymbols(
  store: IndexStore,
  ids: Set<string> | undefined,
  order?: string[],
): SymbolNode[] {
  if (!ids) return []
  const list = order ?? Array.from(ids)
  const out: SymbolNode[] = []
  for (const id of list) {
    const s = store.getSymbolById(id)
    if (s) out.push(s)
  }
  return out
}
