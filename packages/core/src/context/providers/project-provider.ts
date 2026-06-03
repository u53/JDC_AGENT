import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
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

    for (const fileName of PROJECT_FILES) {
      const filePath = join(request.cwd, fileName)
      const content = await readProjectFile(filePath)
      if (content === null) continue

      const summary = summarizeProjectFile(fileName, content)
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
      sections: [section([request.sessionId, SOURCE, ...summaries], 'project_profile', 'Project profile', summaries.join('\n'), citations, 60, 0.86, 'recent', SOURCE)],
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

function summarizeProjectFile(fileName: string, content: string): string {
  if (fileName === 'package.json') return summarizePackageJson(content)
  if (fileName.endsWith('.md')) return summarizeMarkdownProjectFile(fileName, content)
  if (fileName.endsWith('.yaml') || fileName.endsWith('.yml')) return summarizePlainProjectFile(fileName, content, 80)
  return summarizePlainProjectFile(fileName, content, 20)
}

function summarizePackageJson(content: string): string {
  try {
    const pkg = JSON.parse(content) as {
      name?: string
      version?: string
      scripts?: Record<string, string>
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      workspaces?: unknown
    }
    const scripts = Object.entries(pkg.scripts ?? {}).map(([name, command]) => `${name}: ${command}`).join('\n')
    const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }).slice(0, 80).join(', ')
    return [
      `package.json name=${pkg.name ?? basename('package.json')} version=${pkg.version ?? 'unknown'}`,
      scripts ? `scripts:\n${scripts}` : 'scripts: none',
      pkg.workspaces ? `workspaces=${JSON.stringify(pkg.workspaces)}` : 'workspaces: none',
      deps ? `dependencies=${deps}` : 'dependencies: none',
    ].join('\n')
  } catch {
    return 'package.json is present but could not be parsed'
  }
}

function summarizeMarkdownProjectFile(fileName: string, content: string): string {
  const kept: string[] = []
  let currentHeading = ''

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^#{1,3}\s+/.test(line)) {
      currentHeading = line.replace(/^#{1,3}\s+/, '')
      kept.push(`## ${currentHeading}`)
      continue
    }
    if (kept.length >= 120) break
    kept.push(currentHeading ? `${currentHeading}: ${line}` : line)
  }

  return `${fileName}:\n${kept.join('\n')}`
}

function summarizePlainProjectFile(fileName: string, content: string, maxLines: number): string {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, maxLines)
  return `${fileName}:\n${lines.join('\n')}`
}
