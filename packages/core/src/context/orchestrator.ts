import { createHash } from 'node:crypto'
import { budgetContextSections, type ContextBudgetLimits, type DroppedContextSection } from './budgeter.js'
import { planContext } from './planner.js'
import { renderContextBundle } from './prompt-renderer.js'
import { rankContextSections } from './ranker.js'
import { createContextScheduler, type ContextScheduler } from './scheduler.js'
import type { ContextStore, ContextStoreResult } from './store.js'
import type {
  ContextBundle,
  ContextDiagnostic,
  ContextFact,
  ContextFactKind,
  ContextPlan,
  ContextProviderId,
  ContextRequest,
  ContextSection,
  ProviderHealth,
  RawEvidence,
} from './types.js'

export interface ContextProviderResult {
  evidence: RawEvidence[]
  sections: ContextSection[]
  diagnostics: ContextDiagnostic[]
  health: ProviderHealth
}

export interface ContextProvider {
  id: ContextProviderId
  collect(request: ContextRequest): Promise<ContextProviderResult>
}

export interface BuildContextBundleOptions {
  injectionEnabled?: boolean
  store: ContextStore
  providers?: ContextProvider[]
  maxSectionTokens?: number
  maxCodeTokens?: number
  providerTimeoutMs?: number
  scheduler?: ContextScheduler
  now?: () => number
  id?: () => string
  render?: (bundle: ContextBundle, options?: { injectionEnabled?: boolean }) => string
}

export interface BuildContextBundleResult {
  bundle: ContextBundle
  renderedPrompt: string
  dropped: DroppedContextSection[]
  providerHealth: ProviderHealth[]
}

const DEFAULT_PROVIDER_TIMEOUT_MS = 120
const DEFAULT_STORE_FACT_LIMIT = 200
const FOCUSED_STORE_FACT_LIMIT = 75
const MAX_PLAN_SUPPRESSION_DIAGNOSTICS = 25
const HIGH_VALUE_STORE_FACT_KINDS: ContextFactKind[] = ['current_goal', 'known_issue', 'project_convention', 'architecture_decision', 'runtime_error_chain']

export async function buildContextBundle(request: ContextRequest, options: BuildContextBundleOptions): Promise<BuildContextBundleResult> {
  const now = options.now ?? Date.now
  const createId = options.id ?? (() => `ctx_${hashText(`${request.sessionId}:${request.createdAt}:${now()}`).slice(0, 16)}`)
  const scheduler = options.scheduler ?? createContextScheduler({ now })

  if (options.injectionEnabled === false) {
    const bundle = emptyBundle(request, createId(), now(), [diagnostic('ContextOrchestrator', 'info', 'JDC Context Engine context injection disabled; returning empty bundle.', now())])
    return { bundle, renderedPrompt: '', dropped: [], providerHealth: [] }
  }

  try {
    const storeFacts = await loadStoreFacts(options.store)
    throwIfAborted(request.signal)
    const providerResults = await collectProviderResults(request, options.providers ?? [], now, scheduler, options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS)
    throwIfAborted(request.signal)
    const rawSections = [
      ...providerResults.sections,
      ...storeFacts.map((fact) => sectionFromFact(fact)),
    ]
    const plan = planContext(request, rawSections)
    const plannedSectionIds = new Set(plan.relevantSections)
    const plannedSections = rawSections.filter((section) => plannedSectionIds.has(section.id))
    const ranked = rankContextSections(plannedSections)
    const budgeted = budgetContextSections(ranked, budgetLimits(request, options))
    const bundle = makeBundle(request, createId(), now(), budgeted.sections, uniqueCitations(budgeted.sections), [
      ...providerResults.diagnostics,
      ...storeFacts.diagnostics,
      ...diagnosticsFromPlan(plan, rawSections, now()),
    ], budgeted.budget)

    throwIfAborted(request.signal)
    const persistenceDiagnostics = await persistProviderEvidence(options.store, providerResults.evidence, now, request.signal)
    bundle.diagnostics.push(...persistenceDiagnostics)

    throwIfAborted(request.signal)
    const snapshotResult = await options.store.saveBundleSnapshot(bundle)
    bundle.diagnostics.push(...diagnosticsFromStoreResult(snapshotResult, 'saveBundleSnapshot', now))
    throwIfAborted(request.signal)
    const quotaResult = await options.store.enforceQuotas()
    bundle.diagnostics.push(...diagnosticsFromStoreResult(quotaResult, 'enforceQuotas', now))
    throwIfAborted(request.signal)
    await persistDiagnostics(options.store, bundle.diagnostics, request.signal)

    const render = options.render ?? renderContextBundle
    return {
      bundle,
      renderedPrompt: render(bundle, { injectionEnabled: true }),
      dropped: budgeted.dropped,
      providerHealth: providerResults.health,
    }
  } catch (error) {
    const bundle = emptyBundle(request, createId(), now(), [diagnostic('ContextOrchestrator', 'error', errorMessage(error), now())])
    return { bundle, renderedPrompt: '', dropped: [], providerHealth: [] }
  }
}

async function loadStoreFacts(store: ContextStore): Promise<ContextFact[] & { diagnostics: ContextDiagnostic[] }> {
  const general = await store.queryFacts({ minConfidence: 0.01, includeStale: true, limit: DEFAULT_STORE_FACT_LIMIT, orderBy: 'updated_desc' })
  if (!general.ok) throw new Error(general.diagnostics[0]?.message || 'context store queryFacts failed')

  const focused = await store.queryFacts({ minConfidence: 0.01, includeStale: true, limit: FOCUSED_STORE_FACT_LIMIT, kinds: HIGH_VALUE_STORE_FACT_KINDS, orderBy: 'updated_desc' })
  if (!focused.ok) throw new Error(focused.diagnostics[0]?.message || 'context store focused queryFacts failed')

  return Object.assign(dedupeFacts([...general.value, ...focused.value]), { diagnostics: [...general.diagnostics, ...focused.diagnostics] })
}

function dedupeFacts(facts: ContextFact[]): ContextFact[] {
  const seen = new Set<string>()
  const result: ContextFact[] = []
  for (const fact of facts) {
    if (seen.has(fact.id)) continue
    seen.add(fact.id)
    result.push(fact)
  }
  return result
}

async function collectProviderResults(request: ContextRequest, providers: ContextProvider[], now: () => number, scheduler: ContextScheduler, providerTimeoutMs: number): Promise<{
  evidence: RawEvidence[]
  sections: ContextSection[]
  diagnostics: ContextDiagnostic[]
  health: ProviderHealth[]
}> {
  const evidence: RawEvidence[] = []
  const sections: ContextSection[] = []
  const diagnostics: ContextDiagnostic[] = []
  const health: ProviderHealth[] = []

  for (const provider of providers) {
    if (!provider) continue
    if (request.signal?.aborted) break
    try {
      const result = await scheduler.runForeground(
        `provider:${provider.id}`,
        providerTimeoutMs,
        (signal) => provider.collect({ ...request, signal: combineAbortSignals(request.signal, signal) }),
        degradedProviderResult(provider.id, request, now),
      )
      evidence.push(...result.evidence)
      sections.push(...result.sections)
      diagnostics.push(...result.diagnostics)
      health.push(result.health)
    } catch (error) {
      diagnostics.push(diagnostic(`ContextProvider:${provider.id}`, 'error', errorMessage(error), now()))
    }
  }

  return { evidence, sections, diagnostics, health }
}

function combineAbortSignals(parent: AbortSignal | undefined, child: AbortSignal): AbortSignal {
  if (!parent) return child
  if (AbortSignal.any) return AbortSignal.any([parent, child])
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (parent.aborted || child.aborted) {
    abort()
  } else {
    parent.addEventListener('abort', abort, { once: true })
    child.addEventListener('abort', abort, { once: true })
  }
  return controller.signal
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('context bundle cancelled')
}

function degradedProviderResult(id: ContextProviderId, request: ContextRequest, now: () => number): ContextProviderResult {
  const createdAt = now()
  const diag = diagnostic(`ContextProvider:${id}`, 'warning', `Provider ${id} exceeded context budget; returning degraded context.`, createdAt)
  return {
    evidence: [],
    sections: [],
    diagnostics: [diag],
    health: { id, status: 'timeout', updatedAt: request.createdAt || createdAt, diagnostic: diag },
  }
}

async function persistProviderEvidence(store: ContextStore, evidence: RawEvidence[], now: () => number, signal?: AbortSignal): Promise<ContextDiagnostic[]> {
  const diagnostics: ContextDiagnostic[] = []
  for (const item of evidence) {
    throwIfAborted(signal)
    const result = await store.saveRawEvidence(item)
    diagnostics.push(...diagnosticsFromStoreResult(result, 'saveRawEvidence', now))
  }
  return diagnostics
}

function diagnosticsFromStoreResult(result: ContextStoreResult<unknown>, operation: string, now: () => number): ContextDiagnostic[] {
  if (result.ok) return result.diagnostics
  if (result.diagnostics.length) return result.diagnostics
  return [diagnostic('ContextStore', 'error', `${operation} failed without diagnostics`, now())]
}

function diagnosticsFromPlan(plan: ContextPlan, rawSections: ContextSection[], createdAt: number): ContextDiagnostic[] {
  const sectionById = new Map(rawSections.map((section) => [section.id, section]))
  const diagnostics: ContextDiagnostic[] = [
    diagnostic(
      'ContextPlanner',
      'info',
      `Plan ${plan.id} inferred ${plan.intent} intent and selected ${plan.relevantSections.length}/${rawSections.length} context sections.`,
      createdAt,
      false,
    ),
    ...plan.diagnostics,
  ]

  for (const section of plan.suppressedSections.slice(0, MAX_PLAN_SUPPRESSION_DIAGNOSTICS)) {
    diagnostics.push(diagnostic('ContextPlanner', 'info', suppressionDiagnosticMessage(section, sectionById.get(section.id)), createdAt, false))
  }

  const remainingSuppressed = plan.suppressedSections.length - MAX_PLAN_SUPPRESSION_DIAGNOSTICS
  if (remainingSuppressed > 0) {
    diagnostics.push(diagnostic('ContextPlanner', 'info', `Suppressed ${remainingSuppressed} additional context sections; diagnostics capped at ${MAX_PLAN_SUPPRESSION_DIAGNOSTICS}.`, createdAt, false))
  }

  for (const missing of plan.missingEvidence) {
    diagnostics.push(diagnostic('ContextPlanner', 'warning', `Missing ${missing.kind} evidence: ${missing.reason}.`, createdAt, false))
  }

  return diagnostics
}

function suppressionDiagnosticMessage(section: { id: string; reason: string }, contextSection: ContextSection | undefined): string {
  if (!contextSection) return `Suppressed context section ${section.id}: ${section.reason}.`
  return `Suppressed context section ${section.id} (${contextSection.kind} "${contextSection.title}"): ${section.reason}.`
}

async function persistDiagnostics(store: ContextStore, diagnostics: ContextDiagnostic[], signal?: AbortSignal): Promise<void> {
  for (const item of diagnostics) {
    throwIfAborted(signal)
    if (!shouldPersistDiagnostic(item)) continue
    await store.saveDiagnostic(item).catch(() => undefined)
  }
}

function shouldPersistDiagnostic(item: ContextDiagnostic): boolean {
  if (item.source === 'ContextStore' && item.level !== 'info') return true
  if (item.source !== 'ContextPlanner' || item.visibleInPrimaryUi !== false) return false
  return item.message.startsWith('Suppressed context section ') || /^Suppressed \d+ additional context sections/.test(item.message)
}

function budgetLimits(request: ContextRequest, options: BuildContextBundleOptions): ContextBudgetLimits {
  return {
    maxTokens: request.tokenBudget,
    maxSectionTokens: options.maxSectionTokens,
    maxCodeTokens: options.maxCodeTokens,
  }
}

function sectionFromFact(fact: ContextFact): ContextSection {
  return {
    id: `fact_${fact.id}`,
    kind: sectionKindFromFact(fact),
    title: titleFromFact(fact),
    content: fact.content,
    citations: fact.citations,
    priority: priorityFromFact(fact),
    confidence: fact.confidence,
    freshness: fact.freshness,
    sourceProvider: fact.sourceProvider,
    tokenEstimate: estimateTokens(fact.content),
    expiresAt: fact.expiresAt,
  }
}

function sectionKindFromFact(fact: ContextFact): ContextSection['kind'] {
  switch (fact.kind) {
    case 'current_goal':
      return 'user_intent'
    case 'runtime_error_chain':
      return 'runtime_state'
    case 'code_entrypoint':
      return 'relevant_code'
    case 'project_profile':
    case 'architecture_decision':
    case 'module_boundary':
    case 'project_convention':
    case 'workflow_rule':
      return 'project_profile'
    case 'user_preference':
    case 'known_issue':
      return 'memory'
  }
}

function titleFromFact(fact: ContextFact): string {
  return fact.kind.split('_').map((word) => word[0]?.toUpperCase() + word.slice(1)).join(' ')
}

function priorityFromFact(fact: ContextFact): number {
  switch (fact.kind) {
    case 'current_goal':
      return 95
    case 'runtime_error_chain':
      return 90
    case 'code_entrypoint':
      return 80
    case 'architecture_decision':
    case 'project_convention':
    case 'workflow_rule':
      return 70
    case 'project_profile':
    case 'module_boundary':
      return 60
    case 'user_preference':
    case 'known_issue':
      return 50
  }
}

function makeBundle(
  request: ContextRequest,
  id: string,
  createdAt: number,
  sections: ContextSection[],
  citations: ContextBundle['citations'],
  diagnostics: ContextDiagnostic[],
  budget: ContextBundle['budget'],
): ContextBundle {
  return {
    id,
    sessionId: request.sessionId,
    requestHash: requestHash(request),
    createdAt,
    sections,
    citations,
    diagnostics,
    budget,
  }
}

function emptyBundle(request: ContextRequest, id: string, createdAt: number, diagnostics: ContextDiagnostic[]): ContextBundle {
  return makeBundle(request, id, createdAt, [], [], diagnostics, { maxTokens: request.tokenBudget, usedTokens: 0, droppedTokens: 0 })
}

function uniqueCitations(sections: ContextSection[]): ContextBundle['citations'] {
  const seen = new Set<string>()
  const citations: ContextBundle['citations'] = []
  for (const section of sections) {
    for (const citation of section.citations) {
      const key = `${citation.type}:${citation.ref}:${citation.line ?? ''}:${citation.hash ?? ''}:${citation.id}`
      if (seen.has(key)) continue
      seen.add(key)
      citations.push(citation)
    }
  }
  return citations
}

function diagnostic(source: string, level: ContextDiagnostic['level'], message: string, createdAt: number, visibleInPrimaryUi?: boolean): ContextDiagnostic {
  return {
    id: `diag_${hashText(`${source}:${level}:${message}:${createdAt}`).slice(0, 16)}`,
    level,
    source,
    message,
    createdAt,
    ...(visibleInPrimaryUi === undefined ? {} : { visibleInPrimaryUi }),
  }
}

function requestHash(request: ContextRequest): string {
  return hashText(JSON.stringify({ sessionId: request.sessionId, cwd: request.cwd, userMessage: request.userMessage, mode: request.mode, model: request.model, createdAt: request.createdAt }))
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
