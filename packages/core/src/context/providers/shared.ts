import { createHash } from 'node:crypto'
import type {
  ContextCitation,
  ContextDiagnostic,
  ContextProviderId,
  ContextProviderStatus,
  ContextRequest,
  ContextSection,
  EvidenceKind,
  ProviderHealth,
  RawEvidence,
} from '../types.js'

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function nowFromRequest(request: ContextRequest): number {
  return request.createdAt || Date.now()
}

export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4)
}

export function providerHealth(
  id: ContextProviderId,
  status: ContextProviderStatus,
  updatedAt: number,
  diagnostic?: ContextDiagnostic,
): ProviderHealth {
  return diagnostic ? { id, status, updatedAt, diagnostic } : { id, status, updatedAt }
}

export function diagnostic(
  source: string,
  level: ContextDiagnostic['level'],
  message: string,
  createdAt: number,
  citation?: ContextCitation,
): ContextDiagnostic {
  return {
    id: stableId('diag', source, message, String(createdAt)),
    level,
    source,
    message,
    citation,
    createdAt,
  }
}

export function rawEvidence(
  request: ContextRequest,
  sourceProvider: string,
  kind: EvidenceKind,
  content: string,
  metadata: Record<string, unknown>,
  capturedAt = nowFromRequest(request),
): RawEvidence {
  const hash = hashContent(content)
  return {
    id: stableId('raw', request.sessionId, sourceProvider, kind, hash),
    sessionId: request.sessionId,
    cwd: request.cwd,
    sourceProvider,
    kind,
    content,
    metadata,
    capturedAt,
    hash,
  }
}

export function citationFor(evidence: RawEvidence, ref: string, line?: number): ContextCitation {
  return {
    id: stableId('cit', evidence.id, ref, line ? String(line) : ''),
    type: evidence.kind,
    ref,
    line,
    timestamp: evidence.capturedAt,
  }
}

export function section(
  idParts: string[],
  kind: ContextSection['kind'],
  title: string,
  content: string,
  citations: ContextCitation[],
  priority: number,
  confidence: number,
  freshness: ContextSection['freshness'],
  sourceProvider: string,
  ownership?: ContextSection['ownership'],
): ContextSection {
  return {
    id: stableId('section', ...idParts),
    kind,
    title,
    content,
    citations,
    priority,
    confidence,
    freshness,
    sourceProvider,
    tokenEstimate: estimateTokens(content),
    ...(ownership ? { ownership } : {}),
  }
}

export function failedProviderResult(id: ContextProviderId, sourceProvider: string, request: ContextRequest, error: unknown) {
  const createdAt = nowFromRequest(request)
  const diag = diagnostic(sourceProvider, 'error', error instanceof Error ? error.message : String(error), createdAt)
  return {
    evidence: [] as RawEvidence[],
    sections: [] as ContextSection[],
    diagnostics: [diag],
    health: providerHealth(id, 'failed', createdAt, diag),
  }
}

export function disabledProviderResult(id: ContextProviderId, sourceProvider: string, request: ContextRequest) {
  const createdAt = nowFromRequest(request)
  return {
    evidence: [] as RawEvidence[],
    sections: [] as ContextSection[],
    diagnostics: [] as ContextDiagnostic[],
    health: providerHealth(id, 'disabled', createdAt),
  }
}

export function rateLimitedProviderResult(id: ContextProviderId, sourceProvider: string, request: ContextRequest) {
  const createdAt = nowFromRequest(request)
  const diag = diagnostic(sourceProvider, 'warning', `${sourceProvider} is rate-limited; returning degraded context.`, createdAt)
  return {
    evidence: [] as RawEvidence[],
    sections: [] as ContextSection[],
    diagnostics: [diag],
    health: providerHealth(id, 'rate_limited', createdAt, diag),
  }
}

export function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 16)}`
}

export function textFromContentBlocks(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((block) => {
      if (!block || typeof block !== 'object') return []
      const typed = block as { type?: string; text?: unknown; content?: unknown }
      if (typed.type === 'thinking') return []
      if (typed.type === 'text' && typeof typed.text === 'string') return [typed.text]
      if (typed.type === 'tool_result' && typeof typed.content === 'string') return [typed.content]
      return []
    })
    .join('\n')
}
