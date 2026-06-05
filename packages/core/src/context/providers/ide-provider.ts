import type { ContextRequest } from '../types.js'
import {
  citationFor,
  diagnostic,
  nowFromRequest,
  providerHealth,
  rawEvidence,
  section,
} from './shared.js'

const SOURCE = 'IdeSignalProvider'

export interface IdeProviderOptions {
  enabled?: boolean
}

export function collectIdeContext(request: ContextRequest, options: IdeProviderOptions = {}) {
  const capturedAt = nowFromRequest(request)
  if (options.enabled === false) {
    return { evidence: [], sections: [], diagnostics: [], health: providerHealth('ide', 'disabled', capturedAt) }
  }

  if (!request.ide) {
    const diag = diagnostic(SOURCE, 'warning', 'IDE snapshot is unavailable; IDE provider returned stale degraded context.', capturedAt)
    return { evidence: [], sections: [], diagnostics: [diag], health: providerHealth('ide', 'stale', capturedAt, diag) }
  }

  const content = formatIdeSnapshot(request.ide)
  if (!content) {
    const diag = diagnostic(SOURCE, 'warning', 'IDE snapshot did not include active file, selection, or diagnostics.', capturedAt)
    return { evidence: [], sections: [], diagnostics: [diag], health: providerHealth('ide', 'stale', capturedAt, diag) }
  }

  const evidence = rawEvidence(request, SOURCE, 'ide', content, { ide: request.ide }, capturedAt)
  const ref = typeof request.ide.activeFile === 'string' ? request.ide.activeFile : 'ide-snapshot'
  const citation = citationFor(evidence, ref)

  return {
    evidence: [evidence],
    sections: [section(
      [request.sessionId, SOURCE, content],
      'ide_state',
      'IDE state',
      content,
      [citation],
      85,
      0.9,
      'live',
      SOURCE,
      { authority: 'live_state', topic: 'ide', conflictPolicy: 'render' },
    )],
    diagnostics: [],
    health: providerHealth('ide', 'enabled', capturedAt),
  }
}

function formatIdeSnapshot(ide: NonNullable<ContextRequest['ide']>): string {
  const parts: string[] = []
  if (typeof ide.activeFile === 'string') parts.push(`Active file: ${ide.activeFile}`)
  if (ide.selection && typeof ide.selection === 'object') {
    const selection = ide.selection as { text?: unknown; startLine?: unknown; endLine?: unknown }
    const lineInfo = typeof selection.startLine === 'number' ? ` lines ${selection.startLine}${typeof selection.endLine === 'number' ? `-${selection.endLine}` : ''}` : ''
    if (typeof selection.text === 'string' && selection.text.trim()) parts.push(`Selection${lineInfo}: ${selection.text}`)
  }
  const diagnostics = ide.diagnostics
  if (Array.isArray(diagnostics) && diagnostics.length) {
    parts.push(`Diagnostics:\n${diagnostics.map((item) => formatDiagnostic(item)).join('\n')}`)
  }
  return parts.join('\n')
}

function formatDiagnostic(item: unknown): string {
  if (!item || typeof item !== 'object') return `- ${String(item)}`
  const diag = item as { severity?: unknown; message?: unknown }
  const severity = typeof diag.severity === 'string' ? diag.severity : 'diagnostic'
  const message = typeof diag.message === 'string' ? diag.message : JSON.stringify(item)
  return `- ${severity}: ${message}`
}
