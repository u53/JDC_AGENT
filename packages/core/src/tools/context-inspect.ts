import { z } from 'zod'
import type { ToolContext, ToolHandler, ToolResult } from '../tool-registry.js'
import {
  ContextBundleSchema,
  ContextDiagnosticSchema,
  ContextFactSchema,
  ContextProviderIdSchema,
  ContextSectionSchema,
  HarvestJobSchema,
  HarvestStatusSchema,
} from '../context/schemas.js'
import { openContextStore, type ContextAdvancedDiagnostics, type ContextStore, type ContextStoreResult, type RejectedCandidateRecord } from '../context/store.js'
import type { RepoWikiEntry, RepoWikiSummary } from '../context/repo-wiki/index.js'
import type { ContextBundle, ContextDiagnostic, ContextSection, HarvestJob, HarvestStatus, ProviderHealth } from '../context/types.js'

const TokenCostSchema = z.object({ tokenEstimate: z.number().int().nonnegative(), source: z.string().optional(), droppedTokens: z.number().int().nonnegative().optional() })
const ProviderHealthStatusSchema = z.enum(['enabled', 'disabled', 'fresh', 'cached', 'stale', 'not_indexed', 'indexing', 'timeout', 'failed', 'rate_limited'])
const ProviderProgressSchema = z.object({ scanned: z.number().int().nonnegative(), total: z.number().int().nonnegative(), fromSnapshot: z.boolean().optional() })
const ProviderBackgroundJobSchema = z.object({ id: z.string(), status: z.enum(['queued', 'running', 'completed', 'failed']), startedAt: z.number().optional(), completedAt: z.number().optional() })
export const InspectableContextSectionSchema = ContextSectionSchema.extend({
  tokenCost: TokenCostSchema,
})
export const InspectableContextBundleSchema = ContextBundleSchema.extend({ sections: z.array(InspectableContextSectionSchema) })
export const ProviderHealthSchema = z.object({ id: ContextProviderIdSchema, status: ProviderHealthStatusSchema, updatedAt: z.number(), diagnostic: ContextDiagnosticSchema.optional(), progress: ProviderProgressSchema.optional(), backgroundJob: ProviderBackgroundJobSchema.optional() })
export const ProviderTimingSchema = z.object({ id: ContextProviderIdSchema, startedAt: z.number(), completedAt: z.number(), durationMs: z.number().nonnegative(), status: z.string() })
export const DroppedContextSectionSchema = z.object({ section: InspectableContextSectionSchema, reason: z.string(), tokenEstimate: z.number().int().nonnegative() })
export const RejectedMemoryCandidateSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  status: z.enum(['rejected', 'pending_review', 'accepted']),
  candidate: z.unknown(),
  rejectionReason: z.string(),
  validationErrors: z.array(z.string()),
  createdAt: z.number(),
  expiresAt: z.number(),
})

const HarvestSummarySchema = z.object(Object.fromEntries(HarvestStatusSchema.options.map((status) => [status, z.number().int().nonnegative()])) as Record<HarvestStatus, z.ZodNumber>)
const NoopDiagnosticsSummarySchema = z.object({
  rejected: z.number().int().nonnegative(),
  diagnostics: z.number().int().nonnegative(),
  harvestJobs: z.number().int().nonnegative(),
})
const AdvancedDiagnosticsSchema = z.object({
  rejected: z.array(RejectedMemoryCandidateSchema),
  diagnostics: z.array(ContextDiagnosticSchema),
  harvestJobs: z.array(HarvestJobSchema),
  noop: NoopDiagnosticsSummarySchema,
})
const RepoWikiInspectSummarySchema = z.object({
  activeEntries: z.number().int().nonnegative(),
  staleEntries: z.number().int().nonnegative(),
  lastGeneratedAt: z.number().int().nonnegative().optional(),
  lastModelId: z.string().optional(),
  lastDiagnostic: z.string().optional(),
})
const RepoWikiInspectSampleSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  citationRefs: z.array(z.string()),
  confidence: z.number(),
  freshness: z.string(),
  status: z.string(),
})
export const ContextInspectPayloadSchema = z.object({
  status: z.enum(['available', 'empty', 'disabled', 'unavailable']),
  inspectedAt: z.number(),
  bundle: InspectableContextBundleSchema.nullable(),
  acceptedProjectFacts: z.array(ContextFactSchema),
  droppedSections: z.array(DroppedContextSectionSchema),
  providerHealth: z.array(ProviderHealthSchema),
  providerTimings: z.array(ProviderTimingSchema),
  harvestQueue: z.object({ jobs: z.array(HarvestJobSchema), summary: HarvestSummarySchema }),
  memoryReview: z.object({ rejected: z.array(RejectedMemoryCandidateSchema) }),
  diagnostics: z.array(ContextDiagnosticSchema),
  advancedDiagnostics: AdvancedDiagnosticsSchema.optional(),
  schemaInfo: z.object({ version: z.number(), dbPath: z.string(), backupPath: z.string().optional() }).optional(),
  repoWiki: RepoWikiInspectSummarySchema.extend({ samples: z.array(RepoWikiInspectSampleSchema).optional() }).optional(),
})

export type ContextInspectPayload = z.infer<typeof ContextInspectPayloadSchema>

export interface InspectContextInput {
  sessionId?: string
  bundleId?: string
  includeExpiredRejected?: boolean
  includeAdvancedDiagnostics?: boolean
  includeRepoWikiSamples?: boolean
}

export interface InspectContextOptions {
  store?: ContextStore
  cwd?: string
  now?: () => number
  inspectEnabled?: boolean
  droppedSections?: Array<{ section: ContextSection; reason: string; tokenEstimate: number }>
  providerHealth?: ProviderHealth[]
  providerTimings?: z.infer<typeof ProviderTimingSchema>[]
}

export async function inspectContext(input: InspectContextInput = {}, options: InspectContextOptions = {}): Promise<ContextInspectPayload> {
  const now = options.now ?? Date.now
  if (options.inspectEnabled === false) return ContextInspectPayloadSchema.parse(emptyPayload('disabled', now(), [diagnostic('JDC Context Engine inspection is disabled.', 'info', now)]))

  try {
    const store = options.store ?? await openContextStore({ cwd: options.cwd })
    const repoWikiSummaryPromise = store.getRepoWikiSummary ? store.getRepoWikiSummary() : Promise.resolve(successResult<RepoWikiSummary | undefined>(undefined))
    const repoWikiEntriesPromise = input.includeRepoWikiSamples && store.listRepoWikiEntries ? store.listRepoWikiEntries({ includeStale: true, includeArchived: false }) : Promise.resolve(successResult<RepoWikiEntry[]>([]))
    const [bundles, acceptedProjectFacts, storedDiagnostics, schemaInfo, advancedDiagnostics, rejectedMemoryReview, repoWikiSummary, repoWikiEntries] = await Promise.all([
      store.listBundleSnapshots(input.sessionId),
      // Accepted durable facts are project-scoped; sessionId only narrows session diagnostics and bundle inspection.
      store.listAcceptedProjectFacts(),
      store.listDiagnostics(),
      store.getSchemaInfo(),
      input.includeAdvancedDiagnostics
        ? store.listAdvancedDiagnostics({ sessionId: input.sessionId, includeNoop: true })
        : Promise.resolve(successResult(emptyAdvancedDiagnostics())),
      input.includeExpiredRejected
        ? store.listRejectedCandidates({ sessionId: input.sessionId, includeExpired: true })
        : Promise.resolve(successResult([])),
      repoWikiSummaryPromise,
      repoWikiEntriesPromise,
    ])
    const rawDiagnostics = [...collectDiagnostics(bundles, acceptedProjectFacts, storedDiagnostics, schemaInfo, advancedDiagnostics, rejectedMemoryReview, repoWikiSummary, repoWikiEntries), ...(storedDiagnostics.ok ? storedDiagnostics.value : [])]
    const allDiagnostics = filterPrimaryDiagnostics(rawDiagnostics)
    if (!bundles.ok || !acceptedProjectFacts.ok || !storedDiagnostics.ok || !schemaInfo.ok || !advancedDiagnostics.ok || !rejectedMemoryReview.ok) return ContextInspectPayloadSchema.parse(emptyPayload('unavailable', now(), allDiagnostics))

    const bundle = selectBundle(bundles.value, input.bundleId)
    const advanced = collapseNoopDiagnostics(advancedDiagnostics.value)
    const visibleJobs = input.includeAdvancedDiagnostics ? advanced.harvestJobs : []
    const reviewCandidates = input.includeAdvancedDiagnostics ? uniqueRejectedCandidates([...advanced.rejected, ...rejectedMemoryReview.value]) : rejectedMemoryReview.value
    const visibleRejected = reviewCandidates.filter(isPrimaryVisibleRejectedCandidate)
    const payload = {
      status: bundle ? 'available' as const : 'empty' as const,
      inspectedAt: now(),
      bundle: bundle ? inspectableBundle(bundle) : null,
      acceptedProjectFacts: acceptedProjectFacts.value,
      droppedSections: (options.droppedSections ?? []).map((item) => ({ ...item, section: inspectableSection(item.section) })),
      providerHealth: options.providerHealth ?? [],
      providerTimings: options.providerTimings ?? [],
      harvestQueue: { jobs: visibleJobs, summary: summarizeHarvest(visibleJobs.map((job) => job.status)) },
      memoryReview: { rejected: visibleRejected },
      diagnostics: allDiagnostics,
      advancedDiagnostics: input.includeAdvancedDiagnostics ? advanced : undefined,
      schemaInfo: schemaInfo.ok ? schemaInfo.value : undefined,
      repoWiki: repoWikiSummary.ok && repoWikiSummary.value ? { ...repoWikiSummary.value, samples: input.includeRepoWikiSamples && repoWikiEntries.ok ? repoWikiEntries.value.map(repoWikiSample) : undefined } : undefined,
    }
    return ContextInspectPayloadSchema.parse(payload)
  } catch (error) {
    return ContextInspectPayloadSchema.parse(emptyPayload('unavailable', now(), [diagnostic(error instanceof Error ? error.message : String(error), 'error', now)]))
  }
}

export function createContextInspectTool(options: InspectContextOptions = {}): ToolHandler {
  return {
    definition: {
      name: 'JdcContextInspect',
      description: 'Inspect the latest JDC Context Engine injected bundle, citations, confidence, freshness, token cost, harvest queue, memory review, provider health, and Repo Wiki summary.',
      inputSchema: { type: 'object', properties: { sessionId: { type: 'string' }, bundleId: { type: 'string' }, includeExpiredRejected: { type: 'boolean' }, includeAdvancedDiagnostics: { type: 'boolean' }, includeRepoWikiSamples: { type: 'boolean' } } },
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const payload = await inspectContext({ sessionId: stringOrUndefined(input.sessionId), bundleId: stringOrUndefined(input.bundleId), includeExpiredRejected: input.includeExpiredRejected === true, includeAdvancedDiagnostics: input.includeAdvancedDiagnostics === true, includeRepoWikiSamples: input.includeRepoWikiSamples === true }, { ...options, cwd: context.cwd })
      return { content: JSON.stringify(payload, null, 2) }
    },
  }
}

export function inspectableBundle(bundle: ContextBundle): z.infer<typeof InspectableContextBundleSchema> {
  return { ...bundle, diagnostics: filterPrimaryDiagnostics(bundle.diagnostics), sections: bundle.sections.map(inspectableSection) }
}

export function inspectableSection(section: ContextSection): z.infer<typeof InspectableContextSectionSchema> {
  return { ...section, tokenCost: { tokenEstimate: section.tokenEstimate } }
}

function selectBundle(bundles: ContextBundle[], bundleId?: string): ContextBundle | null {
  const candidates = bundleId ? bundles.filter((bundle) => bundle.id === bundleId) : bundles
  return [...candidates].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
}

function summarizeHarvest(statuses: HarvestStatus[]): Record<HarvestStatus, number> {
  const summary = Object.fromEntries(HarvestStatusSchema.options.map((status) => [status, 0])) as Record<HarvestStatus, number>
  for (const status of statuses) summary[status]++
  return summary
}

function collectDiagnostics(...results: Array<ContextStoreResult<unknown>>): ContextDiagnostic[] {
  return results.flatMap((result) => result.diagnostics)
}

function filterPrimaryDiagnostics(diagnostics: ContextDiagnostic[]): ContextDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.visibleInPrimaryUi !== false && !isOperationalHarvestDiagnostic(diagnostic))
}

function collapseNoopDiagnostics(diagnostics: ContextAdvancedDiagnostics): ContextAdvancedDiagnostics & { noop: z.infer<typeof NoopDiagnosticsSummarySchema> } {
  const noopRejected = diagnostics.rejected.filter(isModelNoopRejectedCandidate)
  const noopDiagnostics = diagnostics.diagnostics.filter(isModelNoopDiagnostic)
  const noopHarvestJobs = diagnostics.harvestJobs.filter(isModelNoopHarvestJob)

  return {
    rejected: diagnostics.rejected.filter((candidate) => !isModelNoopRejectedCandidate(candidate)),
    diagnostics: diagnostics.diagnostics.filter((diagnostic) => !isModelNoopDiagnostic(diagnostic)),
    harvestJobs: diagnostics.harvestJobs.filter((job) => !isModelNoopHarvestJob(job)),
    noop: {
      rejected: noopRejected.length,
      diagnostics: noopDiagnostics.length,
      harvestJobs: noopHarvestJobs.length,
    },
  }
}

function isPrimaryVisibleRejectedCandidate(candidate: RejectedCandidateRecord): boolean {
  return candidate.visibleInPrimaryUi !== false && !isAbortHarvestRejectedCandidate(candidate) && !isModelNoopRejectedCandidate(candidate)
}

function uniqueRejectedCandidates(candidates: RejectedCandidateRecord[]): RejectedCandidateRecord[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    if (seen.has(candidate.id)) return false
    seen.add(candidate.id)
    return true
  })
}

function isAbortHarvestRejectedCandidate(candidate: RejectedCandidateRecord): boolean {
  return candidate.rejectionReason === 'Harvest failed' && candidate.validationErrors.some(isAbortLikeText)
}

function isOperationalHarvestDiagnostic(diagnostic: ContextDiagnostic): boolean {
  return diagnostic.source === 'Harvest' || isAbortLikeText(diagnostic.message) || isModelNoopDiagnostic(diagnostic)
}

function isModelNoopRejectedCandidate(candidate: RejectedCandidateRecord): boolean {
  if (candidate.validationErrors.some(isModelNoopText)) return true
  if (isModelNoopText(candidate.rejectionReason)) return true
  return isModelNoopSkipCandidate(candidate.candidate)
}

function isModelNoopHarvestJob(job: HarvestJob): boolean {
  return job.decision?.action === 'skip' && job.decision.reason === 'model_noop'
}

function isModelNoopDiagnostic(diagnostic: ContextDiagnostic): boolean {
  return isModelNoopText(diagnostic.message)
}

function isModelNoopText(text: string): boolean {
  return /model_noop/i.test(text)
}

function isModelNoopSkipCandidate(candidate: unknown): boolean {
  if (!candidate || typeof candidate !== 'object') return false
  const record = candidate as Record<string, unknown>
  return record.action === 'skip' && record.reason === 'model_noop'
}

function isAbortLikeText(text: string): boolean {
  return /request was aborted|aborted|abort|cancelled|canceled|timeout|timed out/i.test(text)
}

function repoWikiSample(entry: RepoWikiEntry): z.infer<typeof RepoWikiInspectSampleSchema> {
  return {
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    citationRefs: entry.citations.map((citation) => citation.ref),
    confidence: entry.confidence,
    freshness: entry.freshness,
    status: entry.status,
  }
}

function emptyPayload(status: ContextInspectPayload['status'], inspectedAt: number, diagnostics: ContextDiagnostic[]): ContextInspectPayload {
  return { status, inspectedAt, bundle: null, acceptedProjectFacts: [], droppedSections: [], providerHealth: [], providerTimings: [], harvestQueue: { jobs: [], summary: summarizeHarvest([]) }, memoryReview: { rejected: [] }, diagnostics, repoWiki: undefined }
}

function emptyAdvancedDiagnostics(): ContextAdvancedDiagnostics {
  return { rejected: [], diagnostics: [], harvestJobs: [] }
}

function successResult<T>(value: T): ContextStoreResult<T> {
  return { ok: true, value, diagnostics: [] }
}

function diagnostic(message: string, level: ContextDiagnostic['level'], now: () => number): ContextDiagnostic {
  return { id: `diag_context_inspect_${now()}_${Math.random().toString(36).slice(2)}`, level, source: 'JdcContextInspect', message, createdAt: now() }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

export type { RejectedCandidateRecord }
