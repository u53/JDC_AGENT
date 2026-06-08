import { createHash } from 'node:crypto'
import path from 'node:path'
import { getContextEngine } from '../../context-engine/index.js'
import type { ContextEngine } from '../../context-engine/engine.js'
import type { ModelConfig } from '../../types.js'
import { createContextScheduler, type ContextScheduler } from '../scheduler.js'
import type { ContextStore, ContextStoreResult } from '../store.js'
import type { ContextDiagnostic, ContextProviderStatus, ContextRequest, ContextSection } from '../types.js'
import { diagnostic, disabledProviderResult, failedProviderResult, nowFromRequest, providerHealth, section } from '../providers/shared.js'
import { buildRepoWikiEvidencePacket } from './evidence.js'
import { generateRepoWikiEntries } from './generator.js'
import type { RepoWikiModelClient } from './model-client.js'
import { retrieveRepoWikiEntries, type RetrievedRepoWikiEntry } from './retrieval.js'
import type { RepoWikiEntry, RepoWikiSummary } from './types.js'

const SOURCE = 'RepoWikiProvider'
const DEFAULT_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000
const repoWikiScheduler = createContextScheduler()
const activeGenerationProjects = new Set<string>()

export interface RepoWikiProviderOptions {
  enabled?: boolean
  store: Pick<ContextStore, 'listRepoWikiEntries' | 'getRepoWikiSummary' | 'saveRepoWikiEntries' | 'saveDiagnostic'>
  scheduler?: ContextScheduler
  getContextEngine?: (cwd: string) => ContextEngine
  modelClient?: RepoWikiModelClient
  modelConfig?: ModelConfig
  providerProtocol?: string
  modelProfileId?: string
  refreshMinIntervalMs?: number
}

export async function collectRepoWikiContext(request: ContextRequest, options: RepoWikiProviderOptions) {
  if (options.enabled === false) return disabledProviderResult('repo_wiki', SOURCE, request)
  const createdAt = nowFromRequest(request)

  try {
    if (!options.store.listRepoWikiEntries || !options.store.getRepoWikiSummary) {
      const diag = diagnostic(SOURCE, 'warning', 'Repo Wiki store methods are unavailable; provider skipped without blocking foreground chat.', createdAt)
      return {
        evidence: [],
        sections: [] as ContextSection[],
        diagnostics: [diag],
        health: providerHealth('repo_wiki', 'failed', createdAt, diag),
      }
    }

    const healthOnly = isRepoWikiHealthOnly(request)
    const [entriesResult, summaryResult] = healthOnly
      ? [undefined, await options.store.getRepoWikiSummary()] as const
      : await Promise.all([
        options.store.listRepoWikiEntries(),
        options.store.getRepoWikiSummary(),
      ])
    const diagnostics = [...(entriesResult?.diagnostics ?? []), ...summaryResult.diagnostics]
    if (!summaryResult.ok || (entriesResult && !entriesResult.ok)) {
      return {
        evidence: [],
        sections: [] as ContextSection[],
        diagnostics,
        health: providerHealth('repo_wiki', 'failed', createdAt, diagnostics[0]),
      }
    }
    const activeEntryCount = summaryResult.value.activeEntries
    const staleEntryCount = summaryResult.value.staleEntries
    if (healthOnly) {
      const status: ContextProviderStatus = staleEntryCount > 0 ? 'stale' : activeEntryCount > 0 ? 'cached' : 'enabled'
      return {
        evidence: [],
        sections: [],
        diagnostics,
        health: providerHealth('repo_wiki', status, createdAt, repoWikiHealthDiagnostic(activeEntryCount, staleEntryCount, createdAt)),
      }
    }

    const entries = entriesResult?.value ?? []
    const selected = retrieveRepoWikiEntries({
      query: request.userMessage,
      evidenceRequirements: request.evidenceRequirements,
      entries,
    })
    const sections = renderRepoWikiSections(request, selected)

    const projectKey = normalizeProjectKey(request.cwd)
    const queueStatus = maybeQueueRepoWikiGeneration({ ...request, cwd: projectKey }, options, activeEntryCount, staleEntryCount, createdAt)
    const status: ContextProviderStatus = sections.length ? 'cached' : queueStatus
    return {
      evidence: [],
      sections,
      diagnostics,
      health: providerHealth('repo_wiki', status, createdAt),
    }
  } catch (error) {
    return failedProviderResult('repo_wiki', SOURCE, request, error)
  }
}

function isRepoWikiHealthOnly(request: ContextRequest): boolean {
  const contextRefresh = request.runtime.contextRefresh as { healthOnly?: boolean } | undefined
  return contextRefresh?.healthOnly === true
}

function repoWikiHealthDiagnostic(activeEntryCount: number, staleEntryCount: number, createdAt: number): ContextDiagnostic {
  return {
    id: `repo_wiki_health_${createdAt}`,
    level: staleEntryCount > 0 ? 'warning' : 'info',
    source: SOURCE,
    message: `Repo Wiki summary active=${activeEntryCount} stale=${staleEntryCount}`,
    createdAt,
  }
}

function renderRepoWikiSections(request: ContextRequest, selected: RetrievedRepoWikiEntry[]): ContextSection[] {
  if (!selected.length) return []
  return [section(
    [request.sessionId, SOURCE, request.userMessage, ...selected.map((item) => item.entry.id)],
    'repo_wiki',
    'Repo Wiki',
    renderRepoWikiSection(selected),
    uniqueCitations(selected.flatMap((item) => item.entry.citations)),
    76,
    Math.max(...selected.map((item) => item.entry.confidence)),
    'cached',
    SOURCE,
    { authority: 'derived_state', topic: 'code', conflictPolicy: 'render' },
  )]
}

function maybeQueueRepoWikiGeneration(request: ContextRequest, options: RepoWikiProviderOptions, activeEntryCount: number, staleEntryCount: number, startedAt: number): ContextProviderStatus {
  const projectKey = normalizeProjectKey(request.cwd)
  if (activeEntryCount > 0 && staleEntryCount === 0) return 'enabled'
  if (!options.modelClient || !options.modelConfig) return 'enabled'
  if (!options.store.saveRepoWikiEntries || !options.store.saveDiagnostic) return 'failed'
  if (activeGenerationProjects.has(projectKey)) return 'indexing'
  const engine = (options.getContextEngine ?? getContextEngine)(projectKey)
  if (!engine.isIndexed()) return 'not_indexed'
  const scheduler = options.scheduler ?? repoWikiScheduler
  const scheduled = scheduler.enqueueBackground(projectKey, 'repo_wiki_generate', async (signal) => {
    try {
      await deferBackgroundTurn()
      const evidence = buildRepoWikiEvidencePacket({ cwd: projectKey, indexStore: engine.getStore(), now: () => startedAt })
      const generated = await generateRepoWikiEntries({
        cwd: projectKey,
        projectKey,
        evidence,
        modelClient: options.modelClient!,
        model: {
          providerProtocol: options.providerProtocol ?? 'anthropic',
          modelId: options.modelConfig!.model,
          modelProfileId: options.modelProfileId,
        },
        modelRequest: {
          modelConfig: options.modelConfig!,
          cacheUser: cacheUserForProject(projectKey),
          signal,
        },
        now: Date.now,
      })
      const diagnostics = [...evidence.diagnostics, ...generated.diagnostics]
      if (generated.entries.length) {
        const saveResult = await options.store.saveRepoWikiEntries!(generated.entries)
        diagnostics.push(...saveResult.diagnostics)
      }
      await saveDiagnostics(options.store.saveDiagnostic!, diagnostics)
    } finally {
      activeGenerationProjects.delete(projectKey)
    }
  }, { minIntervalMs: options.refreshMinIntervalMs ?? DEFAULT_REFRESH_MIN_INTERVAL_MS })
  if (!scheduled.accepted) return 'enabled'
  activeGenerationProjects.add(projectKey)
  void scheduled.promise.finally(() => activeGenerationProjects.delete(projectKey))
  return 'indexing'
}

async function saveDiagnostics(saveDiagnostic: (diagnostic: ContextDiagnostic) => Promise<ContextStoreResult>, diagnostics: ContextDiagnostic[]): Promise<void> {
  for (const item of diagnostics) {
    try {
      await saveDiagnostic(item)
    } catch {
      // Diagnostic persistence is best-effort for background refreshes.
    }
  }
}

function renderRepoWikiSection(selected: RetrievedRepoWikiEntry[]): string {
  return selected.map(({ entry, reasons }) => [
    `## ${entry.title}`,
    `Kind: ${entry.kind}`,
    entry.content,
    reasons.length ? `Matched by: ${reasons.join(', ')}` : '',
    `Citations: ${entry.citations.map((citation) => `${citation.ref}${citation.line ? `:${citation.line}` : ''}`).join(', ')}`,
  ].filter(Boolean).join('\n')).join('\n\n')
}

function uniqueCitations(citations: RepoWikiEntry['citations']): RepoWikiEntry['citations'] {
  const seen = new Set<string>()
  const result: RepoWikiEntry['citations'] = []
  for (const citation of citations) {
    const key = `${citation.type}:${citation.ref}:${citation.line ?? ''}:${citation.hash ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(citation)
  }
  return result
}

function normalizeProjectKey(cwd: string): string {
  return path.resolve(cwd)
}

function deferBackgroundTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function cacheUserForProject(projectKey: string): string {
  return `repo_wiki_${createHash('sha256').update(projectKey).digest('hex')}`
}
