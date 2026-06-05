import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
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
const exec = promisify(execFile)

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
    const [changes, hot, branch, status, recentLog] = await Promise.all([
      workingChanges(request.cwd),
      hotFiles(request.cwd, 50, 10),
      runGit(request.cwd, ['branch', '--show-current']),
      runGit(request.cwd, ['status', '--short']),
      runGit(request.cwd, ['log', '--oneline', '-5']),
    ])

    const branchText = branch?.trim()
    const statusText = status?.trimEnd()
    const recentLogText = recentLog?.trimEnd()

    if (!branchText && !statusText && !recentLogText && changes.length === 0 && hot.length === 0) {
      const diag = diagnostic(SOURCE, 'warning', 'No git status or history was available; git provider returned stale degraded context.', capturedAt)
      return {
        evidence: [],
        sections: [],
        diagnostics: [diag],
        health: providerHealth('git', 'stale', capturedAt, diag),
      }
    }

    const contentParts: string[] = []
    contentParts.push(`branch: ${branchText || 'unknown'}`)
    contentParts.push(statusText ? `status:\n${statusText}` : 'status: clean')
    contentParts.push(recentLogText ? `recent commits:\n${recentLogText}` : 'recent commits: unavailable')
    if (changes.length) contentParts.push(`Working changes:\n${changes.map((change) => `- [${change.status}] ${change.path}`).join('\n')}`)
    if (hot.length) contentParts.push(`Hot files:\n${hot.map((file) => `- ${file.path} (${file.commits} commits)`).join('\n')}`)

    const content = contentParts.join('\n\n')
    const evidence = rawEvidence(request, SOURCE, 'git', content, { branch: branchText, status: statusText, recentLog: recentLogText, changes, hotFiles: hot }, capturedAt)
    const citation = { ...citationFor(evidence, evidence.id), hash: evidence.hash }

    return {
      evidence: [evidence],
      sections: [section(
        [request.sessionId, SOURCE, content],
        'git_state',
        'Git state',
        content,
        [citation],
        55,
        0.84,
        'live',
        SOURCE,
        { authority: 'live_state', topic: 'git', conflictPolicy: 'suppress_if_carried' },
      )],
      diagnostics: [],
      health: providerHealth('git', 'enabled', capturedAt),
    }
  } catch (error) {
    return failedProviderResult('git', SOURCE, request, error)
  }
}

async function runGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await exec('git', args, { cwd, maxBuffer: 1024 * 1024 })
    return stdout
  } catch {
    return null
  }
}
