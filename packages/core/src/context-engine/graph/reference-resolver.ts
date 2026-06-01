// Resolves references (by name) to symbol definitions and builds call edges.
// Name-based resolution — no type information. Strategy per reference:
//   1. same-file definition (highest confidence)
//   2. a definition whose file is plausibly imported by the ref's file
//   3. project-wide unique match by name
//   4. ambiguous (multiple matches) → low confidence, pick all? No: emit one
//      edge per candidate but mark low confidence so callers can dedupe.

import type { CallEdge, ReferenceNode, SymbolNode } from '../types.js'
import type { IndexStore } from './store.js'

export interface ResolvedEdges {
  edges: CallEdge[]
  /** callee symbol id → set of caller symbol ids */
  callersOf: Map<string, Set<string>>
  /** caller symbol id → set of callee symbol ids */
  calleesOf: Map<string, Set<string>>
}

export function buildCallGraph(store: IndexStore): ResolvedEdges {
  const edges: CallEdge[] = []
  const callersOf = new Map<string, Set<string>>()
  const calleesOf = new Map<string, Set<string>>()

  const addEdge = (edge: CallEdge): void => {
    edges.push(edge)
    let callers = callersOf.get(edge.toId)
    if (!callers) {
      callers = new Set()
      callersOf.set(edge.toId, callers)
    }
    callers.add(edge.fromId)
    let callees = calleesOf.get(edge.fromId)
    if (!callees) {
      callees = new Set()
      calleesOf.set(edge.fromId, callees)
    }
    callees.add(edge.toId)
  }

  for (const ref of store.allReferences()) {
    if (!ref.enclosingSymbolId) continue // only intra-symbol calls form edges
    const target = resolveReference(ref, store)
    if (!target) continue
    if (target.symbol.id === ref.enclosingSymbolId) continue // skip self-recursion noise
    addEdge({
      fromId: ref.enclosingSymbolId,
      toId: target.symbol.id,
      filePath: ref.filePath,
      line: ref.line,
      confidence: target.confidence,
    })
  }

  return { edges, callersOf, calleesOf }
}

interface Resolution {
  symbol: SymbolNode
  confidence: 'high' | 'medium' | 'low'
}

/** Resolve a single reference to its most likely definition. */
export function resolveReference(ref: ReferenceNode, store: IndexStore): Resolution | null {
  const candidates = store.symbolsByName(ref.name)
  if (candidates.length === 0) return null
  if (candidates.length === 1) {
    const sameFile = candidates[0].filePath === ref.filePath
    return { symbol: candidates[0], confidence: sameFile ? 'high' : 'medium' }
  }

  // 1. Prefer a same-file definition.
  const sameFile = candidates.filter((c) => c.filePath === ref.filePath)
  if (sameFile.length === 1) return { symbol: sameFile[0], confidence: 'high' }
  if (sameFile.length > 1) {
    return { symbol: pickFunctionish(sameFile), confidence: 'medium' }
  }

  // 2. Prefer a definition whose file matches an import in the ref's file.
  const imports = store.importsForFile(ref.filePath)
  const importedSources = imports.map((i) => i.source).filter(Boolean)
  const byImport = candidates.filter((c) =>
    importedSources.some((src) => fileMatchesImport(c.filePath, src)),
  )
  if (byImport.length === 1) return { symbol: byImport[0], confidence: 'medium' }
  if (byImport.length > 1) return { symbol: pickFunctionish(byImport), confidence: 'low' }

  // 3. Ambiguous global — pick the most "callable" and mark low confidence.
  return { symbol: pickFunctionish(candidates), confidence: 'low' }
}

/** Prefer function/method over variable when the name is overloaded. */
function pickFunctionish(symbols: SymbolNode[]): SymbolNode {
  const fn = symbols.find((s) => s.kind === 'function' || s.kind === 'method')
  return fn ?? symbols[0]
}

/** Heuristic: does a definition file path plausibly match an import specifier? */
function fileMatchesImport(filePath: string, importSource: string): boolean {
  // Strip extension and leading ./ ../, compare basename / tail segments.
  const base = filePath.replace(/\.[^/.]+$/, '')
  const src = importSource.replace(/^[./]+/, '').replace(/\.[^/.]+$/, '')
  if (!src) return false
  return base.endsWith(src) || base.endsWith(`${src}/index`)
}
