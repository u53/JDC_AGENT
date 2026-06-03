import { hotFiles, workingChanges } from '../../context-engine/git/git-context.js'
import type { ContextRequest } from '../types.js'
import {
  citationFor,
  diagnostic,
  failedProviderResult,
  nowFromRequest,
  providerHealth,
  rawEvidence,
  section,
} from './shared.js'

const SOURCE = 'GitSignalProvider'

export interface GitProviderOptions {
  enabled?: boolean
}

export async function collectGitContext(request: ContextRequest, options: GitProviderOptions = {}) {
  if (options.enabled === false) {
    const { disabledProviderResult } = await import('./shared.js')
    return disabledProviderResult('git', SOURCE, request)
  }

  try {
    const capturedAt = nowFromRequest(request)
    const [changes, hot] = await Promise.all([
      workingChanges(request.cwd),
      hotFiles(request.cwd, 50, 10),
    ])

    if (changes.length === 0 && hot.length === 0) {
      const diag = diagnostic(SOURCE, 'warning', 'No git status or history was available; git provider returned stale degraded context.', capturedAt)
      return {
        evidence: [],
        sections: [],
        diagnostics: [diag],
        health: providerHealth('git', 'stale', capturedAt, diag),
      }
    }

    const contentParts: string[] = []
    if (changes.length) contentParts.push(`Working changes:\n${changes.map((change) => `- [${change.status}] ${change.path}`).join('\n')}`)
    if (hot.length) contentParts.push(`Hot files:\n${hot.map((file) => `- ${file.path} (${file.commits} commits)`).join('\n')}`)

    const content = contentParts.join('\n\n')
    const evidence = rawEvidence(request, SOURCE, 'git', content, { changes, hotFiles: hot }, capturedAt)
    const citation = { ...citationFor(evidence, evidence.id), hash: evidence.hash }

    return {
      evidence: [evidence],
      sections: [section([request.sessionId, SOURCE, content], 'git_state', 'Git state', content, [citation], 55, 0.84, 'live', SOURCE)],
      diagnostics: [],
      health: providerHealth('git', 'enabled', capturedAt),
    }
  } catch (error) {
    return failedProviderResult('git', SOURCE, request, error)
  }
}
