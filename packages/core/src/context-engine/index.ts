// Public surface for the JDC Context Engine.

import { ContextEngine } from './engine.js'

export { ContextEngine } from './engine.js'
export type { IndexProgress } from './engine.js'
export { IndexStore } from './graph/store.js'
export { CallGraph } from './graph/call-graph.js'
export { EngineQuery } from './query.js'
export type { SymbolLocation, NodeDetail, ContextResult } from './query.js'
export { getContextEnginePromptSegment } from './prompt.js'
export type { ContextEnginePromptSegment } from './prompt.js'
export { hotFiles, workingChanges, uncommittedDiff, blameRange } from './git/git-context.js'
export type { GitHotFile, GitChange, BlameLine } from './git/git-context.js'
export type { StoreSnapshot } from './graph/store.js'
export { loadSnapshot, saveSnapshot, SNAPSHOT_VERSION } from './indexer/snapshot.js'
export * from './types.js'
export { supportedLanguageIds, supportedExtensions, languageForPath } from './parser/languages.js'

// Per-cwd singleton cache so all sessions on a project share one index.
const engines = new Map<string, ContextEngine>()

export function getContextEngine(cwd: string): ContextEngine {
  let engine = engines.get(cwd)
  if (!engine) {
    engine = new ContextEngine(cwd)
    engines.set(cwd, engine)
  }
  return engine
}

export function disposeContextEngine(cwd: string): void {
  engines.delete(cwd)
}
