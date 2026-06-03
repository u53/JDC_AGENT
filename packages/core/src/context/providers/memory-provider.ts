import type { ContextRequest } from '../types.js'
import { disabledProviderResult, nowFromRequest, providerHealth } from './shared.js'

const SOURCE = 'MemorySignalProvider'

export interface MemoryProviderOptions {
  enabled?: boolean
  memoryDir?: string
  maxMemories?: number
}

export async function collectMemoryContext(request: ContextRequest, options: MemoryProviderOptions = {}) {
  if (options.enabled === false) return disabledProviderResult('memory', SOURCE, request)
  return {
    evidence: [],
    sections: [],
    diagnostics: [],
    health: providerHealth('memory', 'cached', nowFromRequest(request)),
  }
}
