import { createHash } from 'node:crypto'
import { DEFAULT_CONTEXT_ENGINE_CONFIG } from './config.js'
import { classifyHarvestCandidate, prepareCandidateForDistillation } from './safety.js'
import type { AcceptanceOptions } from './safety.js'
import { AUTO_ACCEPT_CONTEXT_FACT_KINDS, type ContextDiagnostic, type ContextFact, type ContextOrigin, type DistillerEnvelope, type DistillerOutput, type HarvestCandidate, type HarvestJob, type HarvestModelBinding, type HarvestStatus, type MemoryCandidatePayload, type MemoryTrustMode, type RawEvidence, type SkipReason } from './types.js'
import { HarvestCandidateSchema, HarvestJobSchema, HarvestModelBindingSchema } from './schemas.js'
import { defaultHarvestDistillers, selectDistillerForDecision, validateDistillerOutput, type ContextDistiller, type DistillerContext, type DistillerModelClient } from './distillers/index.js'
import { contextFactKindFromMemoryKind } from '../tools/memory-search.js'
import type { ContextOperationStatus, ContextPerformanceRecorder } from './performance.js'
import { classifyHarvestPlan, type HarvestClassifier } from './harvest-classifier.js'

export type HarvestDistiller = ContextDistiller
export type { DistillerContext }

export interface HarvestStoreResult<T = void> {
  ok: boolean
  value: T
  diagnostics: ContextDiagnostic[]
}

export interface HarvestPersistence {
  saveHarvestJob?(job: HarvestJob): Promise<HarvestStoreResult>
  updateHarvestJob?(job: HarvestJob): Promise<HarvestStoreResult>
  saveRawEvidence?(evidence: RawEvidence): Promise<HarvestStoreResult>
  saveFact?(fact: ContextFact): Promise<HarvestStoreResult>
  saveDiagnostic?(diagnostic: ContextDiagnostic): Promise<HarvestStoreResult>
  rejectCandidate?(candidate: unknown, reason: string, options?: { id?: string; sessionId?: string; createdAt?: number; ttlMs?: number; validationErrors?: string[]; status?: 'rejected' | 'pending_review'; visibleInPrimaryUi?: boolean }): Promise<HarvestStoreResult<unknown>>
  enforceQuotas?(): Promise<HarvestStoreResult<unknown>>
}

export interface EnqueueHarvestOptions {
  enabled?: boolean
  store?: HarvestPersistence
  now?: () => number
  createId?: () => string
}

export interface RunHarvestJobOptions extends AcceptanceOptions {
  store?: HarvestPersistence
  distillers?: HarvestDistiller[]
  modelClient?: DistillerModelClient
  now?: () => number
  maxOutputTokens?: number
  trustMode?: MemoryTrustMode
  timeoutMs?: number
  signal?: AbortSignal
  recorder?: ContextPerformanceRecorder
  projectKey?: string
  ambientModelBindingForTest?: HarvestModelBinding
  classifier?: HarvestClassifier
}

export interface HarvestRunResult {
  status: HarvestStatus
  job?: HarvestJob
  diagnostics: ContextDiagnostic[]
}

export async function enqueueHarvest(candidate: HarvestCandidate, modelBinding: HarvestModelBinding, options: EnqueueHarvestOptions = {}): Promise<HarvestRunResult> {
  const now = options.now ?? Date.now
  const diagnostics: ContextDiagnostic[] = []
  const parsedCandidate = HarvestCandidateSchema.safeParse(candidate)
  const parsedBinding = HarvestModelBindingSchema.safeParse(modelBinding)

  if (!parsedCandidate.success) {
    diagnostics.push(makeHarvestDiagnostic(`Harvest candidate rejected before enqueue: ${parsedCandidate.error.message}`, 'warning', now))
    await persistDiagnostics(options.store, diagnostics)
    return { status: 'failed', diagnostics }
  }

  if (!parsedBinding.success) {
    diagnostics.push(makeHarvestDiagnostic(`Harvest model binding rejected before enqueue: ${parsedBinding.error.message}`, 'warning', now))
    await persistDiagnostics(options.store, diagnostics)
    return { status: 'skipped', diagnostics }
  }

  const canonicalCandidate = candidate
  const canonicalBinding = modelBinding

  const createdAt = now()
  const job: HarvestJob = {
    id: options.createId?.() ?? `harvest_${createdAt}_${Math.random().toString(36).slice(2)}`,
    sessionId: canonicalCandidate.sessionId,
    runLoopId: canonicalCandidate.runLoopId,
    status: options.enabled === false ? 'skipped' : 'queued',
    candidate: canonicalCandidate,
    decision: options.enabled === false ? { action: 'skip', reason: 'rate_limited' } : undefined,
    modelBinding: canonicalBinding,
    createdAt,
    updatedAt: createdAt,
  }

  await options.store?.saveHarvestJob?.(job)
  if (options.enabled === false) {
    diagnostics.push(makeHarvestDiagnostic('Harvest skipped because harvest feature flag is disabled', 'info', now))
    await persistDiagnostics(options.store, diagnostics)
  }

  return { status: job.status, job, diagnostics }
}

export async function runHarvestJob(job: HarvestJob, options: RunHarvestJobOptions = {}): Promise<HarvestRunResult> {
  const now = options.now ?? Date.now
  const metricStartedAt = now()
  const diagnostics: ContextDiagnostic[] = []
  const finish = (result: HarvestRunResult, metricStatus?: ContextOperationStatus, diagnosticMessage?: string): HarvestRunResult => {
    recordHarvestMetric(job, result, options, metricStartedAt, now, metricStatus, diagnosticMessage)
    return result
  }
  const parsed = HarvestJobSchema.safeParse(job)
  if (!parsed.success) {
    diagnostics.push(makeHarvestDiagnostic(`Harvest job rejected before run: ${parsed.error.message}`, 'warning', now))
    await persistDiagnostics(options.store, diagnostics)
    return finish({ status: 'failed', diagnostics }, 'failed', parsed.error.message)
  }

  const canonicalJob = job

  if (job.status === 'skipped') return finish({ status: 'skipped', job, diagnostics })

  let current = canonicalJob
  try {
    const prepared = prepareCandidateForDistillation(canonicalJob.candidate)
    current = updateJob(canonicalJob, 'classified', now)
    await options.store?.updateHarvestJob?.(current)

    const fallbackDecision = prepared.decision ?? classifyHarvestCandidate(prepared.candidate)
    const planned = await classifyHarvestPlan(prepared.candidate, {
      classifier: options.classifier,
      fallbackDecision,
      modelBinding: current.modelBinding,
    })
    if (planned.diagnostics.length) {
      const classifierDiagnostics = planned.diagnostics.map((message) => makeHarvestDiagnostic(message, 'warning', now))
      diagnostics.push(...classifierDiagnostics)
      await persistDiagnostics(options.store, classifierDiagnostics)
    }
    const decision = planned.decision
    current = { ...current, decision, updatedAt: now() }
    if (decision.action === 'skip') {
      return finish(await skipJob(current, decision.reason, `Harvest skipped: ${decision.reason}`, options.store, now))
    }

    const distiller = selectDistillerForDecision(decision, options.distillers ?? defaultHarvestDistillers)
    if (!distiller) {
      return finish(await rejectJob(current, prepared.candidate, `No distiller registered for ${decision.action}`, ['missing distiller'], options.store, now))
    }

    current = updateJob(current, 'distilling', now)
    await options.store?.updateHarvestJob?.(current)
    const output = await distillWithAbort(distiller, prepared.candidate, {
      modelBinding: current.modelBinding,
      modelClient: options.modelClient,
      maxOutputTokens: options.maxOutputTokens,
    }, {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    })
    if (isDistillerSkipOutput(output)) {
      return finish(await skipJob(current, output.reason, output.diagnostic ?? `Harvest model skipped durable storage: ${output.reason}`, options.store, now, {
        visibleInPrimaryUi: false,
      }))
    }
    if (isDistillerBatchOutput(output)) {
      return finish(await acceptBatchOutput(current, output, prepared.candidate, options, now))
    }
    const envelope = output

    current = updateJob(current, 'validating', now)
    await options.store?.updateHarvestJob?.(current)
    const minConfidence = options.minConfidence ?? DEFAULT_CONTEXT_ENGINE_CONFIG.memory.minConfidence
    const validation = validateDistillerOutput(envelope, {
      minConfidence,
      citationSources: options.citationSources ?? citationSourcesForCandidate(prepared.candidate),
    })

    if (!validation.accepted) {
      return finish(await rejectJob(current, envelope, 'Distiller output rejected by schema/citation/confidence/safety validation', validation.errors, options.store, now))
    }

    const evidenceDiagnostics = await persistCandidateEvidence(options.store, prepared.candidate, now)
    if (evidenceDiagnostics.length) diagnostics.push(...evidenceDiagnostics)

    const fact = factFromAcceptedEnvelope(envelope, current, now())
    if (fact.confidence < minConfidence) {
      return finish(await rejectJob(current, fact, 'Distiller output rejected by derived fact confidence policy', [`confidence ${fact.confidence} is below minimum ${minConfidence}`], options.store, now))
    }

    const trustMode = options.trustMode ?? DEFAULT_CONTEXT_ENGINE_CONFIG.memory.trustMode
    if (!shouldAutoAcceptFact(fact, trustMode)) {
      current = updateJob(current, 'pending_review', now)
      await options.store?.updateHarvestJob?.(current)
      await options.store?.rejectCandidate?.(envelope, 'pending_review', { sessionId: current.sessionId, createdAt: now(), status: 'pending_review' })
      await persistDiagnostics(options.store, [makeHarvestDiagnostic(pendingReviewDiagnostic(envelope, fact, trustMode), 'info', now)])
      await enforceQuotas(options.store)
      return finish({ status: 'pending_review', job: current, diagnostics })
    }

    const savedFact = await options.store?.saveFact?.(fact)
    if (savedFact && !savedFact.ok) {
      return finish(await rejectJob(current, fact, 'Accepted harvest output could not be persisted as durable context', savedFact.diagnostics.map((diagnostic) => diagnostic.message), options.store, now))
    }

    current = updateJob(current, 'accepted', now)
    await options.store?.updateHarvestJob?.(current)
    await persistDiagnostics(options.store, [makeHarvestDiagnostic(`Harvest accepted ${envelope.distiller} output`, 'info', now)])
    await enforceQuotas(options.store)
    return finish({ status: 'accepted', job: current, diagnostics })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isAbortLikeHarvestError(error)) {
      const metricStatus: ContextOperationStatus = isTimeoutLikeHarvestError(error) ? 'timeout' : 'cancelled'
      const reason: SkipReason = metricStatus
      return finish(await skipJob(current, reason, `Harvest ${reason} without blocking foreground chat: ${message}`, options.store, now), metricStatus, message)
    }
    const failed = updateJob(current, 'failed', now)
    const diagnostic = makeHarvestDiagnostic(`Harvest failed without blocking foreground chat: ${message}`, 'error', now)
    await options.store?.updateHarvestJob?.(failed)
    await persistDiagnostics(options.store, [diagnostic])
    await options.store?.rejectCandidate?.(canonicalJob.candidate, 'Harvest failed', { sessionId: canonicalJob.sessionId, createdAt: now(), validationErrors: [message] })
    return finish({ status: 'failed', job: failed, diagnostics: [diagnostic] }, 'failed', message)
  }
}

function recordHarvestMetric(job: HarvestJob, result: HarvestRunResult, options: RunHarvestJobOptions, startedAt: number, now: () => number, statusOverride?: ContextOperationStatus, diagnostic?: string): void {
  if (!options.recorder) return
  const finalJob = result.job ?? job
  options.recorder.record({
    name: 'context:harvest',
    lane: 'background',
    status: statusOverride ?? harvestMetricStatus(result),
    startedAt,
    completedAt: now(),
    projectKey: options.projectKey ?? finalJob.candidate.origin?.projectKey,
    diagnostic,
    metadata: {
      sessionId: finalJob.sessionId,
      runLoopId: finalJob.runLoopId,
      finalStatus: result.status,
    },
  })
}

function harvestMetricStatus(result: HarvestRunResult): ContextOperationStatus {
  if (result.status === 'accepted') return 'success'
  if (result.status === 'skipped') {
    const reason = result.job?.decision?.action === 'skip' ? result.job.decision.reason : undefined
    if (reason === 'timeout') return 'timeout'
    if (reason === 'cancelled') return 'cancelled'
    return 'rejected'
  }
  return 'failed'
}

function isDistillerSkipOutput(output: DistillerOutput): output is Extract<DistillerOutput, { action: 'skip' }> {
  return Boolean(output && typeof output === 'object' && 'action' in output && output.action === 'skip')
}

function isDistillerBatchOutput(output: DistillerOutput): output is Extract<DistillerOutput, { facts: DistillerEnvelope[] }> {
  return Boolean(output && typeof output === 'object' && 'facts' in output && Array.isArray((output as { facts?: unknown }).facts))
}

async function acceptBatchOutput(job: HarvestJob, batch: Extract<DistillerOutput, { facts: DistillerEnvelope[] }>, candidate: HarvestCandidate, options: RunHarvestJobOptions, now: () => number): Promise<HarvestRunResult> {
  const diagnostics: ContextDiagnostic[] = []
  const minConfidence = options.minConfidence ?? DEFAULT_CONTEXT_ENGINE_CONFIG.memory.minConfidence
  const citationSources = options.citationSources ?? citationSourcesForCandidate(candidate)
  const trustMode = options.trustMode ?? DEFAULT_CONTEXT_ENGINE_CONFIG.memory.trustMode
  let acceptedCount = 0
  let pendingCount = 0
  let rejectedCount = 0

  const evidenceDiagnostics = await persistCandidateEvidence(options.store, candidate, now)
  diagnostics.push(...evidenceDiagnostics)

  for (const skipped of batch.skipped ?? []) {
    diagnostics.push(makeHarvestDiagnostic(skipped.diagnostic ?? `Batch distiller skipped fact: ${skipped.reason}`, 'info', now))
  }

  for (const envelope of batch.facts) {
    const validation = validateDistillerOutput(envelope, { minConfidence, citationSources })
    if (!validation.accepted) {
      rejectedCount++
      await options.store?.rejectCandidate?.(envelope, 'Batch distiller fact rejected by schema/citation/confidence/safety validation', {
        sessionId: job.sessionId,
        createdAt: now(),
        validationErrors: validation.errors,
      })
      diagnostics.push(makeHarvestDiagnostic(`Batch distiller fact rejected: ${validation.errors.join('; ')}`, 'warning', now))
      continue
    }

    const fact = factFromAcceptedEnvelope(envelope, job, now())
    if (fact.confidence < minConfidence) {
      rejectedCount++
      const message = `confidence ${fact.confidence} is below minimum ${minConfidence}`
      await options.store?.rejectCandidate?.(fact, 'Batch distiller fact rejected by derived fact confidence policy', {
        sessionId: job.sessionId,
        createdAt: now(),
        validationErrors: [message],
      })
      diagnostics.push(makeHarvestDiagnostic(`Batch distiller fact rejected: ${message}`, 'warning', now))
      continue
    }

    if (!shouldAutoAcceptFact(fact, trustMode)) {
      pendingCount++
      await options.store?.rejectCandidate?.(envelope, 'pending_review', { sessionId: job.sessionId, createdAt: now(), status: 'pending_review' })
      diagnostics.push(makeHarvestDiagnostic(pendingReviewDiagnostic(envelope, fact, trustMode), 'info', now))
      continue
    }

    const savedFact = await options.store?.saveFact?.(fact)
    if (savedFact && !savedFact.ok) {
      rejectedCount++
      await options.store?.rejectCandidate?.(fact, 'Batch distiller accepted fact could not be persisted as durable context', {
        sessionId: job.sessionId,
        createdAt: now(),
        validationErrors: savedFact.diagnostics.map((diagnostic) => diagnostic.message),
      })
      diagnostics.push(...savedFact.diagnostics)
      continue
    }

    acceptedCount++
  }

  const finalStatus: HarvestStatus = acceptedCount > 0 ? 'accepted' : pendingCount > 0 ? 'pending_review' : rejectedCount > 0 ? 'rejected' : 'skipped'
  const completed = updateJob(job, finalStatus, now)
  await options.store?.updateHarvestJob?.(completed)
  diagnostics.push(makeHarvestDiagnostic(`Harvest batch processed ${acceptedCount} accepted, ${pendingCount} pending, ${rejectedCount} rejected facts`, acceptedCount > 0 ? 'info' : 'warning', now))
  await persistDiagnostics(options.store, diagnostics)
  await enforceQuotas(options.store)
  return { status: finalStatus, job: completed, diagnostics }
}

async function distillWithAbort(distiller: HarvestDistiller, candidate: HarvestCandidate, context: DistillerContext, options: { timeoutMs?: number; signal?: AbortSignal }): Promise<DistillerOutput> {
  const abortState = createDistillerAbortState(options)
  const taskPromise = Promise.resolve().then(() => distiller.distill(candidate, {
    ...context,
    modelClient: modelClientWithSignal(context.modelClient, abortState.signal),
  }))
  if (!abortState.abortPromise) return taskPromise

  taskPromise.catch(() => undefined)
  try {
    return await Promise.race([taskPromise, abortState.abortPromise])
  } finally {
    abortState.dispose()
  }
}

function modelClientWithSignal(modelClient: DistillerModelClient | undefined, signal: AbortSignal | undefined): DistillerModelClient | undefined {
  if (!modelClient || !signal) return modelClient
  return {
    completeAnthropicMessages: (request) => modelClient.completeAnthropicMessages({ ...request, signal }),
    completeOpenAIChatCompletions: (request) => modelClient.completeOpenAIChatCompletions({ ...request, signal }),
    completeOpenAIResponses: (request) => modelClient.completeOpenAIResponses({ ...request, signal }),
  }
}

function createDistillerAbortState(options: { timeoutMs?: number; signal?: AbortSignal }): { signal?: AbortSignal; abortPromise?: Promise<never>; dispose(): void } {
  if (options.signal?.aborted) throw harvestAbortErrorFromSignal(options.signal)
  if (options.timeoutMs === undefined && !options.signal) return { dispose: () => undefined }

  const controller = new AbortController()
  let rejectAbort: ((error: Error) => void) | undefined
  const abortPromise = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  const abortWith = (error: Error) => {
    if (!controller.signal.aborted) controller.abort(error)
    rejectAbort?.(error)
  }
  const onAbort = () => abortWith(harvestAbortErrorFromSignal(options.signal))
  let timeout: ReturnType<typeof setTimeout> | undefined

  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.timeoutMs !== undefined) {
    timeout = setTimeout(() => abortWith(makeHarvestAbortError('Harvest timed out during model distillation', 'TimeoutError')), options.timeoutMs)
  }

  return {
    signal: controller.signal,
    abortPromise,
    dispose() {
      if (timeout) clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
      rejectAbort = undefined
    },
  }
}

function harvestAbortErrorFromSignal(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) return signal.reason
  return makeHarvestAbortError('Harvest cancelled during model distillation', 'AbortError')
}

function makeHarvestAbortError(message: string, name: 'AbortError' | 'TimeoutError'): Error {
  const error = new Error(message)
  error.name = name
  return error
}

function shouldAutoAcceptFact(fact: ContextFact, trustMode: MemoryTrustMode): boolean {
  return trustMode === 'auto_accept_high_confidence' && AUTO_ACCEPT_CONTEXT_FACT_KINDS.includes(fact.kind as (typeof AUTO_ACCEPT_CONTEXT_FACT_KINDS)[number])
}

function pendingReviewDiagnostic(envelope: DistillerEnvelope, fact: ContextFact, trustMode: MemoryTrustMode): string {
  if (trustMode === 'manual_review') return `Harvest output queued for manual review (${envelope.distiller})`
  return `Harvest output queued for review because ${fact.kind} is not eligible for high-confidence auto-accept`
}

function factFromAcceptedEnvelope(envelope: DistillerEnvelope, job: HarvestJob, now: number): ContextFact {
  const payload = envelope.payload as Record<string, unknown>
  const content = contentFromEnvelope(envelope)
  const id = `harvest_${hashAcceptedEnvelope(job.id, envelope).slice(0, 16)}`
  return {
    id,
    kind: kindFromEnvelope(envelope),
    scope: scopeFromEnvelope(envelope),
    content,
    citations: envelope.citations,
    confidence: confidenceFromEnvelope(envelope),
    freshness: 'recent',
    sourceProvider: `Harvest:${envelope.distiller}`,
    sessionId: job.sessionId,
    createdAt: now,
    updatedAt: now,
    expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : undefined,
    origin: originFromHarvestJob(job),
  }
}

function originFromHarvestJob(job: HarvestJob): ContextOrigin | undefined {
  const candidateOrigin = job.candidate.origin
  const projectKey = candidateOrigin?.projectKey
  if (!candidateOrigin || !projectKey) return undefined
  return {
    projectKey,
    actor: candidateOrigin.actor ?? 'main_session',
    sessionId: candidateOrigin.sessionId ?? job.sessionId,
    runLoopId: candidateOrigin.runLoopId ?? job.runLoopId,
    subSessionId: candidateOrigin.subSessionId,
    teamId: candidateOrigin.teamId,
    memberId: candidateOrigin.memberId,
    taskId: candidateOrigin.taskId,
    artifactId: candidateOrigin.artifactId,
    toolUseId: candidateOrigin.toolUseId,
    messageId: candidateOrigin.messageId,
    providerProtocol: job.modelBinding.providerProtocol,
    modelId: job.modelBinding.modelId,
  }
}

export function kindFromEnvelope(envelope: DistillerEnvelope): ContextFact['kind'] {
  switch (envelope.distiller) {
    case 'MemoryCuratorDistiller':
      return contextFactKindFromMemoryKind((envelope.payload as MemoryCandidatePayload).kind)
    case 'ConversationStateDistiller':
      return 'current_goal'
    case 'RuntimeNarrativeDistiller':
      return 'runtime_error_chain'
    case 'ProjectProfileDistiller':
      return 'project_profile'
    case 'CodeTaskDistiller':
      return 'code_entrypoint'
    case 'TeamLedgerDistiller':
      return (envelope.payload as { kind?: ContextFact['kind'] }).kind === 'task_result' ? 'task_result' : 'team_decision'
    case 'ArtifactSummaryDistiller':
      return 'artifact_summary'
    case 'QaIssueDistiller':
      return 'qa_issue'
    case 'WorkflowRuleDistiller':
      return 'workflow_rule'
    default:
      return 'project_profile'
  }
}

export function scopeFromEnvelope(envelope: DistillerEnvelope): ContextFact['scope'] {
  const scope = (envelope.payload as Record<string, unknown>).scope
  if (scope === 'global' || scope === 'project' || scope === 'repo' || scope === 'session') return scope
  return envelope.distiller === 'ConversationStateDistiller' || envelope.distiller === 'RuntimeNarrativeDistiller' ? 'session' : 'project'
}

export function confidenceFromEnvelope(envelope: DistillerEnvelope): number {
  const payloadConfidence = (envelope.payload as Record<string, unknown>).confidence
  return typeof payloadConfidence === 'number' ? Math.min(envelope.confidence, payloadConfidence) : envelope.confidence
}

export function contentFromEnvelope(envelope: DistillerEnvelope): string {
  const payload = envelope.payload as Record<string, unknown>
  if (typeof payload.content === 'string') return payload.content
  if (typeof payload.currentGoal === 'string') return payload.currentGoal
  if (typeof payload.summary === 'string') return [payload.summary, typeof payload.rootCause === 'string' ? payload.rootCause : ''].filter(Boolean).join('\n')
  if (typeof payload.projectPurpose === 'string') return payload.projectPurpose
  return JSON.stringify(payload)
}

function hashAcceptedEnvelope(jobId: string, envelope: DistillerEnvelope): string {
  return createHash('sha256').update(JSON.stringify({ jobId, distiller: envelope.distiller, payload: envelope.payload, citations: envelope.citations })).digest('hex')
}

function citationSourcesForCandidate(candidate: HarvestCandidate): NonNullable<AcceptanceOptions['citationSources']> {
  return {
    messages: candidateMessageCitationSources(candidate),
    toolEvents: candidate.toolEvents,
    retainedFileSnapshots: candidate.changedFiles.map((ref) => ({ ref })),
  }
}

async function persistCandidateEvidence(store: HarvestPersistence | undefined, candidate: HarvestCandidate, now: () => number): Promise<ContextDiagnostic[]> {
  if (!store?.saveRawEvidence) return []
  const diagnostics: ContextDiagnostic[] = []
  const evidence = candidateEvidence(candidate, now())
  for (const item of evidence) {
    const saved = await store.saveRawEvidence(item)
    if (saved && !saved.ok) diagnostics.push(...saved.diagnostics)
  }
  return diagnostics
}

function candidateEvidence(candidate: HarvestCandidate, capturedAt: number): RawEvidence[] {
  const entries: RawEvidence[] = [
    rawEvidenceForCandidateMessage(candidate, `${candidate.runLoopId}:user`, candidate.userMessage, capturedAt),
  ]

  for (const message of candidate.assistantMessages) {
    const text = textFromMessageContent(message.content)
    if (text) entries.push(rawEvidenceForCandidateMessage(candidate, message.id, text, capturedAt))
  }

  for (const event of candidate.toolEvents) {
    entries.push(rawEvidenceForCandidateToolEvent(candidate, event, capturedAt))
  }

  return entries
}

function rawEvidenceForCandidateMessage(candidate: HarvestCandidate, messageId: string, content: string, capturedAt: number): RawEvidence {
  return {
    id: `harvest_message_${hashText(`${candidate.sessionId}:${candidate.runLoopId}:${messageId}`).slice(0, 16)}`,
    sessionId: candidate.sessionId,
    cwd: 'harvest-candidate',
    sourceProvider: 'HarvestCandidateEvidence',
    kind: 'message',
    content,
    metadata: { messageId, runLoopId: candidate.runLoopId },
    capturedAt,
    hash: hashText(content),
  }
}

function rawEvidenceForCandidateToolEvent(candidate: HarvestCandidate, event: HarvestCandidate['toolEvents'][number], capturedAt: number): RawEvidence {
  const content = JSON.stringify(event)
  return {
    id: `harvest_tool_${hashText(`${candidate.sessionId}:${candidate.runLoopId}:${event.id}`).slice(0, 16)}`,
    sessionId: candidate.sessionId,
    cwd: 'harvest-candidate',
    sourceProvider: 'HarvestCandidateEvidence',
    kind: 'tool_event',
    content,
    metadata: { eventId: event.id, runLoopId: candidate.runLoopId },
    capturedAt,
    hash: hashText(content),
  }
}

function candidateMessageCitationSources(candidate: HarvestCandidate): Array<{ id: string }> {
  return [
    { id: `${candidate.runLoopId}:user` },
    ...candidate.assistantMessages.map((message) => ({ id: message.id })),
  ]
}

function textFromMessageContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.flatMap((block) => {
    if (!block || typeof block !== 'object') return []
    const typed = block as { type?: string; text?: unknown; content?: unknown }
    if (typed.type === 'thinking') return []
    if (typed.type === 'text' && typeof typed.text === 'string') return [typed.text]
    if (typed.type === 'tool_result' && typeof typed.content === 'string') return [typed.content]
    return []
  }).join('\n')
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

async function rejectJob(job: HarvestJob, candidate: unknown, reason: string, validationErrors: string[], store: HarvestPersistence | undefined, now: () => number): Promise<HarvestRunResult> {
  const rejected = updateJob(job, 'rejected', now)
  const diagnostic = makeHarvestDiagnostic(`${reason}: ${validationErrors.join('; ')}`, 'warning', now)
  await store?.updateHarvestJob?.(rejected)
  await store?.rejectCandidate?.(candidate, reason, { sessionId: job.sessionId, createdAt: now(), validationErrors })
  await persistDiagnostics(store, [diagnostic])
  await enforceQuotas(store)
  return { status: 'rejected', job: rejected, diagnostics: [diagnostic] }
}

async function skipJob(job: HarvestJob, reason: SkipReason, message: string, store: HarvestPersistence | undefined, now: () => number, options: { visibleInPrimaryUi?: boolean } = {}): Promise<HarvestRunResult> {
  const skipped = { ...updateJob(job, 'skipped', now), decision: { action: 'skip' as const, reason }, visibleInPrimaryUi: options.visibleInPrimaryUi }
  const diagnostic = { ...makeHarvestDiagnostic(message, 'info', now), visibleInPrimaryUi: options.visibleInPrimaryUi }
  await store?.updateHarvestJob?.(skipped)
  if (options.visibleInPrimaryUi === false) {
    await store?.rejectCandidate?.({ action: 'skip', reason }, message, {
      sessionId: job.sessionId,
      createdAt: now(),
      validationErrors: [reason],
      status: 'rejected',
      visibleInPrimaryUi: false,
    })
  }
  await persistDiagnostics(store, [diagnostic])
  await enforceQuotas(store)
  return { status: 'skipped', job: skipped, diagnostics: [diagnostic] }
}

async function enforceQuotas(store: HarvestPersistence | undefined): Promise<void> {
  await store?.enforceQuotas?.().catch(() => undefined)
}

function updateJob(job: HarvestJob, status: HarvestStatus, now: () => number): HarvestJob {
  return { ...job, status, updatedAt: now() }
}

async function persistDiagnostics(store: HarvestPersistence | undefined, diagnostics: ContextDiagnostic[]): Promise<void> {
  for (const diagnostic of diagnostics) await store?.saveDiagnostic?.(diagnostic)
}

function makeHarvestDiagnostic(message: string, level: ContextDiagnostic['level'], now: () => number): ContextDiagnostic {
  return {
    id: `diagnostic_harvest_${now()}_${Math.random().toString(36).slice(2)}`,
    level,
    source: 'Harvest',
    message,
    createdAt: now(),
  }
}

function isAbortLikeHarvestError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  return name === 'AbortError' || name === 'TimeoutError' || /aborted|abort|cancelled|canceled|timeout/i.test(message)
}

function isTimeoutLikeHarvestError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  return name === 'TimeoutError' || /timeout|timed out/i.test(message)
}
