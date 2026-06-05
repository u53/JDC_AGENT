import type { ContextRequest } from '../types.js'
import type { ContextStore } from '../store.js'
import { diagnostic, disabledProviderResult, failedProviderResult, nowFromRequest, providerHealth, section } from './shared.js'

const SOURCE = 'MemorySignalProvider'

export interface MemoryProviderOptions {
  enabled?: boolean
  store?: Pick<ContextStore, 'listAcceptedProjectFacts'>
  memoryDir?: string
  /**
   * Debug-only override for targeted tests or explicit UI filtering. The
   * provider deliberately has no production default cap: accepted project memory
   * is selected by retrieval/planning, not by a hidden count limit.
   */
  maxMemories?: number
}

export async function collectMemoryContext(request: ContextRequest, options: MemoryProviderOptions = {}) {
  if (options.enabled === false) return disabledProviderResult('memory', SOURCE, request)
  if (!options.store) {
    return {
      evidence: [],
      sections: [],
      diagnostics: [],
      health: providerHealth('memory', 'cached', nowFromRequest(request)),
    }
  }

  try {
    const capturedAt = nowFromRequest(request)
    const result = await options.store.listAcceptedProjectFacts({
      minConfidence: 0.01,
      includeStale: false,
      includeExpired: false,
      ...(options.maxMemories === undefined ? {} : { limit: options.maxMemories }),
      orderBy: 'updated_desc',
    })
    if (!result.ok) {
      const diag = result.diagnostics[0] ?? diagnostic(SOURCE, 'warning', 'Memory provider could not read accepted project facts.', capturedAt)
      return {
        evidence: [],
        sections: [],
        diagnostics: [diag, ...result.diagnostics.filter((item) => item.id !== diag.id)],
        health: providerHealth('memory', 'failed', capturedAt, diag),
      }
    }

    const facts = result.value
    if (facts.length === 0) {
      return {
        evidence: [],
        sections: [],
        diagnostics: result.diagnostics,
        health: providerHealth('memory', 'cached', capturedAt),
      }
    }

    const content = facts.map((fact) => `- [${fact.kind}] ${fact.content}`).join('\n')
    const citations = facts.flatMap((fact) => fact.citations)
    return {
      evidence: [],
      sections: [section(
        [request.sessionId, SOURCE, ...facts.map((fact) => fact.id)],
        'memory',
        'Project memory',
        content,
        citations,
        80,
        Math.max(...facts.map((fact) => fact.confidence)),
        'cached',
        SOURCE,
        { authority: 'durable_memory', topic: 'memory', conflictPolicy: 'render' },
      )],
      diagnostics: result.diagnostics,
      health: providerHealth('memory', 'cached', capturedAt),
    }
  } catch (error) {
    return failedProviderResult('memory', SOURCE, request, error)
  }
}
