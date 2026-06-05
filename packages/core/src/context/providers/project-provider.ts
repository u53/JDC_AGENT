import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ContextRequest } from '../types.js'
import {
  citationFor,
  diagnostic,
  failedProviderResult,
  nowFromRequest,
  providerHealth,
  rateLimitedProviderResult,
  rawEvidence,
  section,
} from './shared.js'

const SOURCE = 'ProjectSignalProvider'
const PROJECT_FILES = ['package.json', 'pnpm-workspace.yaml', 'tsconfig.json', 'JDCAGNET.md', 'AGENTS.md', 'README.md']

export interface ProjectProviderOptions {
  enabled?: boolean
  rateLimited?: boolean
}

function carriedInstructionRefs(request: ContextRequest): Set<string> {
  return new Set(request.carriedContext?.projectInstructionRefs ?? [])
}

export async function collectProjectContext(request: ContextRequest, options: ProjectProviderOptions = {}) {
  if (options.enabled === false) {
    const { disabledProviderResult } = await import('./shared.js')
    return disabledProviderResult('project', SOURCE, request)
  }
  if (options.rateLimited) return rateLimitedProviderResult('project', SOURCE, request)

  try {
    const capturedAt = nowFromRequest(request)
    const evidence = []
    const summaries: string[] = []
    const carriedRefs = carriedInstructionRefs(request)

    for (const fileName of PROJECT_FILES) {
      if (carriedRefs.has(fileName)) continue
      const filePath = join(request.cwd, fileName)
      const content = await readProjectFile(filePath)
      if (content === null) continue

      const summary = projectFileContext(fileName, content)
      summaries.push(summary)
      evidence.push(rawEvidence(request, SOURCE, fileName.endsWith('.json') || fileName.endsWith('.yaml') ? 'config' : 'file', summary, { file: fileName }, capturedAt))
    }

    if (evidence.length === 0) {
      const diag = diagnostic(SOURCE, 'warning', 'No project metadata files were found; project provider returned degraded context.', capturedAt)
      return {
        evidence: [],
        sections: [],
        diagnostics: [diag],
        health: providerHealth('project', 'stale', capturedAt, diag),
      }
    }

    const citations = evidence.map((item) => citationFor(item, String(item.metadata.file ?? item.id)))
    return {
      evidence,
      sections: [section(
        [request.sessionId, SOURCE, ...summaries],
        'project_profile',
        'Project profile',
        summaries.join('\n'),
        citations,
        60,
        0.86,
        'recent',
        SOURCE,
        { authority: 'live_state', topic: 'project_profile', conflictPolicy: 'render' },
      )],
      diagnostics: [],
      health: providerHealth('project', 'enabled', capturedAt),
    }
  } catch (error) {
    return failedProviderResult('project', SOURCE, request, error)
  }
}

async function readProjectFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

// Project metadata files are a first-class project signal. Do not summarize or
// truncate them here for local token budgeting; provider adapters own any
// protocol-safe fallback if a model request later rejects the full payload.
function projectFileContext(fileName: string, content: string): string {
  return `${fileName}:\n${content.trimEnd()}`
}
