import { EngineQuery } from '../../context-engine/query.js'
import { buildRepoMap, renderRepoMap, type RepoMapOptions } from '../../context-engine/repo-map.js'
import { getContextEngine } from '../../context-engine/index.js'
import type { ContextEngine, IndexProgress } from '../../context-engine/engine.js'
import type { ContextDiagnostic, ContextRequest, ProviderHealth } from '../types.js'
import { createContextScheduler, type BackgroundRejectReason, type ContextScheduler } from '../scheduler.js'
import { collectFallbackCodeEvidence, type FallbackCodeEvidenceResult } from './code-fallback.js'
import {
  citationFor,
  diagnostic,
  failedProviderResult,
  nowFromRequest,
  providerHealth,
  rawEvidence,
  section,
  stableId,
} from './shared.js'

const SOURCE = 'CodeSignalProvider'
const codeIndexScheduler = createContextScheduler()

type IndexJobStatus = 'queued' | 'running' | 'completed' | 'failed'

type CodeIndexJobStatus = Omit<CodeIndexJob, 'promise' | 'error'> & { error?: string; cancelable: false }

interface CodeIndexJob {
  id: string
  cwd: string
  status: IndexJobStatus
  startedAt: number
  completedAt?: number
  progress?: IndexProgress
  error?: unknown
  promise: Promise<void>
}

const codeIndexJobs = new Map<string, CodeIndexJob>()

export interface CodeProviderOptions {
  contextEngine?: ContextEngine
  getContextEngine?: (cwd: string) => ContextEngine
  maxNodes?: number
  includeCode?: boolean
  enabled?: boolean
  reindex?: boolean
  healthOnly?: boolean
  scheduler?: ContextScheduler
}

export async function collectCodeContext(request: ContextRequest, options: CodeProviderOptions = {}) {
  if (options.enabled === false) {
    const { disabledProviderResult } = await import('./shared.js')
    return disabledProviderResult('code', SOURCE, request)
  }

  try {
    const engine = options.contextEngine ?? (options.getContextEngine ?? getContextEngine)(request.cwd)
    const reindex = options.reindex === true || requestedReindex(request)
    const healthOnly = options.healthOnly === true || requestedHealthOnly(request)
    if (!engine.isIndexed()) {
      if (healthOnly) return unindexedProviderResult(request, getCodeIndexJob(request.cwd))
      const fallback = await collectFallbackCodeEvidence({ cwd: request.cwd, requirements: request.evidenceRequirements ?? [], query: request.userMessage })
      const indexJob = ensureCodeIndexJob(request.cwd, engine, nowFromRequest(request), options.scheduler)
      return unindexedProviderResult(request, indexJob, fallback)
    }
    const indexJob = reindex ? ensureCodeIndexJob(request.cwd, engine, nowFromRequest(request), options.scheduler) : getCodeIndexJob(request.cwd)
    if (!indexJob && !reindex) codeIndexJobs.delete(request.cwd)
    if (healthOnly) return indexedProviderHealthResult(request, indexJob)

    const result = await queryIndexedCodeContext(engine, request, options).catch(async (error) => {
      const fallback = await collectFallbackCodeEvidence({ cwd: request.cwd, requirements: request.evidenceRequirements ?? [], query: request.userMessage })
      if (fallback.matches.length) return fallbackProviderResult(request, fallback, error, indexJob)
      throw error
    })
    if ('fallback' in result) return result.fallback
    const capturedAt = nowFromRequest(request)
    const evidence = []

    for (const entry of result.entryPoints) {
      evidence.push(rawEvidence(request, SOURCE, 'file', `${entry.name} ${entry.kind} at ${entry.file}:${entry.line}`, { symbol: entry.name, kind: entry.kind, file: entry.file, line: entry.line }, capturedAt))
    }
    for (const code of result.keyCode) {
      evidence.push(rawEvidence(request, SOURCE, 'file', code.code, { symbol: code.symbol, file: code.file }, capturedAt))
    }

    const citations = evidence.map((item) => {
      const metadata = item.metadata as { file?: unknown; line?: unknown }
      return citationFor(item, typeof metadata.file === 'string' ? metadata.file : item.id, typeof metadata.line === 'number' ? metadata.line : undefined)
    })

    const contentParts: string[] = []
    if (result.entryPoints.length) {
      contentParts.push(`Entry points:\n${result.entryPoints.map((entry) => `- ${entry.name} (${entry.kind}) — ${entry.file}:${entry.line}`).join('\n')}`)
    }
    if (result.related.length) {
      contentParts.push(`Related symbols:\n${result.related.map((entry) => `- ${entry.name} (${entry.kind}) — ${entry.file}:${entry.line}`).join('\n')}`)
    }
    if (result.keyCode.length) {
      contentParts.push(`Source snippets:\n${result.keyCode.map((snippet) => `- ${snippet.symbol} — ${snippet.file}`).join('\n')}`)
    }

    const repoMapOptions = repoMapRequestOptions(request, options)
    const repoMap = repoMapOptions ? buildRepoMap(engine.getStore(), repoMapOptions) : undefined
    const repoMapSection = repoMap?.files.length
      ? section(
        [request.sessionId, SOURCE, 'repo_map', request.userMessage],
        'code_map',
        'Repository map',
        renderRepoMap(repoMap),
        [],
        70,
        0.82,
        'live',
        SOURCE,
        { authority: 'code_evidence', topic: 'code', conflictPolicy: 'render' },
      )
      : undefined

    const sections = contentParts.length
      ? [section(
        [request.sessionId, SOURCE, request.userMessage],
        'relevant_code',
        'Relevant code',
        contentParts.join('\n\n'),
        citations,
        90,
        0.9,
        'live',
        SOURCE,
        { authority: 'code_evidence', topic: 'code', conflictPolicy: 'render' },
      )]
      : []
    if (repoMapSection) sections.push(repoMapSection)

    return {
      evidence,
      sections,
      diagnostics: [],
      health: indexJob ? withIndexJob(providerHealth('code', indexJob.status === 'failed' ? 'failed' : 'indexing', capturedAt), indexJob) : providerHealth('code', 'enabled', capturedAt),
    }
  } catch (error) {
    return failedProviderResult('code', SOURCE, request, error)
  }
}

export function getCodeProviderHealth(request: ContextRequest, options: CodeProviderOptions = {}): ProviderHealth {
  const createdAt = nowFromRequest(request)
  if (options.enabled === false) return providerHealth('code', 'disabled', createdAt)

  try {
    const engine = options.contextEngine ?? (options.getContextEngine ?? getContextEngine)(request.cwd)
    const job = getCodeIndexJob(request.cwd)
    if (job) {
      const message = job.status === 'failed'
        ? `Code index failed in the background: ${job.error instanceof Error ? job.error.message : String(job.error)}`
        : `Code reindex job is ${job.status}; provider health is read-only and did not start indexing.`
      const diag = diagnostic(SOURCE, job.status === 'failed' ? 'error' : 'warning', message, createdAt)
      return withIndexJob(providerHealth('code', job.status === 'failed' ? 'failed' : 'indexing', createdAt, diag), job)
    }
    if (!engine.isIndexed()) {
      const diag = diagnostic(SOURCE, 'warning', 'Code index is not ready; provider health is read-only and did not start indexing.', createdAt)
      return providerHealth('code', 'not_indexed', createdAt, diag)
    }
    return providerHealth('code', 'enabled', createdAt)
  } catch (error) {
    return failedProviderResult('code', SOURCE, request, error).health
  }
}

export function ensureCodeIndexJob(cwd: string, engine: ContextEngine, startedAt: number, scheduler: ContextScheduler = codeIndexScheduler): CodeIndexJob {
  const existing = codeIndexJobs.get(cwd)
  if (existing && (existing.status === 'queued' || existing.status === 'running')) return existing

  const job: CodeIndexJob = {
    id: stableId('code_index_job', cwd),
    cwd,
    status: 'queued',
    startedAt,
    promise: Promise.resolve(),
  }
  const scheduled = scheduler.enqueueBackground(cwd, 'code_index', async (signal) => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    if (signal.aborted) {
      const error = new Error('code index job cancelled before start')
      job.status = 'failed'
      job.error = error
      job.completedAt = Date.now()
      throw error
    }
    job.status = 'running'
    try {
      await engine.index((progress) => {
        job.progress = progress
      })
      if (signal.aborted) throw new Error('code index job cancelled')
      job.status = 'completed'
      job.completedAt = Date.now()
    } catch (error) {
      job.status = 'failed'
      job.error = error
      job.completedAt = Date.now()
      throw error
    }
  })
  if (scheduled.accepted) {
    job.promise = scheduled.promise
  } else {
    job.error = scheduled.reason
    job.promise = Promise.resolve()
    return job
  }
  /*
    Indexing is intentionally started by the scheduler task after a timer tick,
    so foreground provider collection only records/enqueues work and returns.
  */
  codeIndexJobs.set(cwd, job)
  return job
}

function getCodeIndexJob(cwd: string): CodeIndexJob | undefined {
  const job = codeIndexJobs.get(cwd)
  if (!job) return undefined
  if (job.status === 'completed') {
    codeIndexJobs.delete(cwd)
    return undefined
  }
  return job
}

export function getCodeIndexJobStatus(cwd: string): CodeIndexJobStatus | undefined {
  const job = getCodeIndexJob(cwd)
  if (!job) return undefined
  const { promise: _promise, error, ...status } = job
  return { ...status, cancelable: false, error: error === undefined ? undefined : error instanceof Error ? error.message : String(error) }
}

function unindexedProviderResult(request: ContextRequest, job?: CodeIndexJob, fallback?: FallbackCodeEvidenceResult) {
  const createdAt = nowFromRequest(request)
  const rejectReason = schedulerRejectReason(job?.error)
  const { evidence: fallbackEvidence, sections: fallbackSections } = fallbackCodeContext(request, fallback, createdAt)
  const fallbackMessage = fallbackEvidence.length > 0
    ? ' Fallback code evidence was collected for this turn.'
    : ''
  const message = job
    ? rejectReason
      ? `Code index was deferred by scheduler (${rejectReason}); retry shortly.${fallbackMessage}`
      : job.status === 'failed'
      ? `Code index failed in the background: ${job.error instanceof Error ? job.error.message : String(job.error)}${fallbackMessage}`
      : `Code index is warming in the background; job is ${job.status}.${fallbackMessage}`
    : 'Code index is not ready; provider health is read-only and did not start indexing.'
  const diag = diagnostic(SOURCE, job?.status === 'failed' ? 'error' : 'warning', message, createdAt)
  const health = providerHealth('code', job ? rejectReason ? 'rate_limited' : job.status === 'failed' ? 'failed' : 'indexing' : 'not_indexed', createdAt, diag)
  return {
    evidence: fallbackEvidence,
    sections: fallbackSections,
    diagnostics: [diag],
    health: job ? withIndexJob(health, job) : health,
  }
}

function indexedProviderHealthResult(request: ContextRequest, job?: CodeIndexJob) {
  const createdAt = nowFromRequest(request)
  const rejectReason = schedulerRejectReason(job?.error)
  const health = job ? providerHealth('code', rejectReason ? 'rate_limited' : job.status === 'failed' ? 'failed' : 'indexing', createdAt) : providerHealth('code', 'enabled', createdAt)
  return {
    evidence: [],
    sections: [],
    diagnostics: [] as ContextDiagnostic[],
    health: job ? withIndexJob(health, job) : health,
  }
}

async function queryIndexedCodeContext(engine: ContextEngine, request: ContextRequest, options: CodeProviderOptions) {
  const query = new EngineQuery(engine)
  return request.evidenceRequirements?.length
    ? await query.contextForRequirements({
      objective: request.userMessage,
      requirements: request.evidenceRequirements,
      activeFile: typeof request.ide?.activeFile === 'string' ? request.ide.activeFile : undefined,
      maxNodes: options.maxNodes ?? 10,
      includeCode: options.includeCode !== false,
    })
    : await query.context(request.userMessage, options.maxNodes ?? 10, options.includeCode !== false)
}

function fallbackProviderResult(request: ContextRequest, fallback: FallbackCodeEvidenceResult, error: unknown, job?: CodeIndexJob) {
  const createdAt = nowFromRequest(request)
  const { evidence, sections } = fallbackCodeContext(request, fallback, createdAt)
  const diag = diagnostic(SOURCE, 'warning', `Code index query failed; returning fallback code evidence for this turn: ${error instanceof Error ? error.message : String(error)}`, createdAt)
  return {
    fallback: {
      evidence,
      sections,
      diagnostics: [diag],
      health: job ? withIndexJob(providerHealth('code', job.status === 'failed' ? 'failed' : 'indexing', createdAt, diag), job) : providerHealth('code', 'enabled', createdAt, diag),
    },
  }
}

function fallbackCodeContext(request: ContextRequest, fallback: FallbackCodeEvidenceResult | undefined, capturedAt: number) {
  const evidence = (fallback?.matches ?? []).map((match) => rawEvidence(
    request,
    SOURCE,
    'file',
    match.preview,
    { file: match.file, line: match.line, fallback: true, reason: match.reason },
    capturedAt,
  ))
  const citations = evidence.map((item) => {
    const metadata = item.metadata as { file?: unknown; line?: unknown }
    return citationFor(item, typeof metadata.file === 'string' ? metadata.file : item.id, typeof metadata.line === 'number' ? metadata.line : undefined)
  })
  const sections = fallback && evidence.length
    ? [section(
      [request.sessionId, SOURCE, request.userMessage, 'fallback'],
      'relevant_code',
      'Fallback code matches',
      fallback.content,
      citations,
      65,
      0.55,
      'live',
      SOURCE,
      { authority: 'code_evidence', topic: 'code', conflictPolicy: 'render' },
    )]
    : []
  return { evidence, sections }
}

function schedulerRejectReason(error: unknown): BackgroundRejectReason | undefined {
  return error === 'project_concurrency_limit' || error === 'project_interval_limit' ? error : undefined
}

function repoMapRequestOptions(request: ContextRequest, options: CodeProviderOptions): RepoMapOptions | undefined {
  const requiresRepoMap = request.mode === 'plan' || request.evidenceRequirements?.some((requirement) => requirement.kind === 'repo_map') === true
  if (!requiresRepoMap) return undefined
  const maxFiles = Math.max(1, options.maxNodes ?? 12)
  return {
    objective: request.evidenceRequirements?.find((requirement) => requirement.kind === 'repo_map')?.query || request.userMessage,
    maxFiles,
    maxSymbols: maxFiles,
    maxImportEdges: maxFiles,
    maxTopSymbolsPerFile: 1,
  }
}

function requestedReindex(request: ContextRequest): boolean {
  const refresh = request.runtime.contextRefresh
  return typeof refresh === 'object' && refresh !== null && (refresh as { reindex?: unknown }).reindex === true
}

function requestedHealthOnly(request: ContextRequest): boolean {
  const refresh = request.runtime.contextRefresh
  return typeof refresh === 'object' && refresh !== null && (refresh as { healthOnly?: unknown }).healthOnly === true
}

function withIndexJob(health: ProviderHealth, job: CodeIndexJob): ProviderHealth {
  return {
    ...health,
    progress: job.progress,
    backgroundJob: {
      id: job.id,
      status: job.status,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    },
  }
}
