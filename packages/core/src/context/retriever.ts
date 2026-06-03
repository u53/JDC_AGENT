import type { ContextDiagnostic, ContextFact, ContextRequest } from './types.js'
import type { ContextStore } from './store.js'

export interface RetrievedContextFact {
  fact: ContextFact
  score: number
  reasons: string[]
}

export interface ContextRetrievalResult {
  facts: RetrievedContextFact[]
  diagnostics: ContextDiagnostic[]
}

export interface ContextRetrievalOptions {
  store: Pick<ContextStore, 'listAcceptedProjectFacts'>
  limit?: number
  candidateLimit?: number
  now?: () => number
}

export async function retrieveContextFacts(_request: ContextRequest, _options: ContextRetrievalOptions): Promise<ContextRetrievalResult> {
  return { facts: [], diagnostics: [] }
}
