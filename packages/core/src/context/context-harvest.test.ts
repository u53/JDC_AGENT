import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openContextStore } from './store.js'
import type { ContextDiagnostic, ContextFact, DistillerEnvelope, HarvestCandidate, HarvestJob, HarvestModelBinding, RawEvidence } from './types.js'
import { enqueueHarvest, runHarvestJob, type HarvestDistiller, type HarvestPersistence } from './harvest.js'
import type { DistillerModelClient } from './distillers/index.js'

const baseCandidate: HarvestCandidate = {
  sessionId: 'session_1',
  runLoopId: 'run_1',
  userMessage: 'Remember that we always run context tests with no file parallelism.',
  assistantMessages: [
    { id: 'assistant_1', role: 'assistant', content: [{ type: 'text', text: 'Noted.' }], timestamp: 2 },
  ],
  toolEvents: [],
  changedFiles: [],
  createdAt: 1,
}

const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
  tmpDirs.length = 0
})

describe('harvest queue safety chain', () => {
  it('persists accepted harvest envelopes as durable context facts and memory records through ContextStore', async () => {
    const dbPath = makeDbPath()
    const store = await openContextStore({ dbPath, now: () => 1_000 })
    const enqueued = await enqueueHarvest(baseCandidate, makeBinding('anthropic'), { store, now: () => 1_000, createId: () => 'job_durable_memory' })
    const completed = await runHarvestJob(enqueued.job!, {
      store,
      distillers: [{ name: 'MemoryCuratorDistiller', distill: async () => memoryEnvelope('Use no-file-parallelism for context tests.', 'cit_user_run_1') }],
      now: () => 2_000,
    })

    expect(completed.status).toBe('accepted')
    const facts = await store.queryFacts({ citationRef: 'run_1:user' })
    expect(facts.ok).toBe(true)
    expect(facts.value).toHaveLength(1)
    expect(facts.value[0]).toMatchObject({
      kind: 'workflow_rule',
      scope: 'project',
      content: 'Use no-file-parallelism for context tests.',
      sourceProvider: 'Harvest:MemoryCuratorDistiller',
      confidence: 0.92,
      freshness: 'recent',
    })

    const reopened = await openContextStore({ dbPath, now: () => 3_000 })
    const reopenedFacts = await reopened.queryFacts({ citationRef: 'run_1:user' })
    expect(reopenedFacts.value.map((fact) => fact.content)).toContain('Use no-file-parallelism for context tests.')
  })

  it('rejects accepted envelopes that cannot be persisted as cited durable facts', async () => {
    const store = makeStore({ saveFactResult: { ok: false, value: undefined, diagnostics: [diagnostic('durable context requires at least one citation')] } })
    const enqueued = await enqueueHarvest(baseCandidate, makeBinding('openai-chat'), { store, now: () => 2_500, createId: () => 'job_fact_reject' })
    const completed = await runHarvestJob(enqueued.job!, {
      store,
      distillers: [{ name: 'MemoryCuratorDistiller', distill: async () => memoryEnvelope('Rejected by store.', 'cit_user_run_1') }],
      now: () => 2_600,
    })

    expect(completed.status).toBe('rejected')
    expect(store.saveFact).toHaveBeenCalled()
    expect(store.rejectedCandidates.at(-1)?.reason).toBe('Accepted harvest output could not be persisted as durable context')
    expect(store.jobs.at(-1)?.status).toBe('rejected')
  })

  it('persists the runLoop-captured model binding for all supported protocols and passes it to distillers unchanged', async () => {
    for (const providerProtocol of ['anthropic', 'openai-chat', 'openai-responses'] as const) {
      const store = makeStore()
      const binding = makeBinding(providerProtocol, `${providerProtocol}-model`)
      const seenBindings: HarvestModelBinding[] = []
      const distiller: HarvestDistiller = {
        name: 'MemoryCuratorDistiller',
        distill: async (_candidate, context) => {
          seenBindings.push(context.modelBinding)
          return memoryEnvelope(`Binding model ${context.modelBinding.modelId}`, 'cit_user_run_1')
        },
      }

      const enqueued = await enqueueHarvest(baseCandidate, binding, { store, now: () => 10, createId: () => `job_${providerProtocol}` })
      expect(enqueued.status).toBe('queued')
      expect(store.jobs[0]?.modelBinding).toEqual(binding)

      const changedAmbientBinding = makeBinding(providerProtocol, 'ambient-model-after-runLoop')
      const completed = await runHarvestJob(enqueued.job!, { store, distillers: [distiller], now: () => 20, ambientModelBindingForTest: changedAmbientBinding })
      expect(completed.status).toBe('accepted')
      expect(seenBindings).toEqual([binding])
      expect(store.jobs.at(-1)?.modelBinding).toEqual(binding)
    }
  })

  it('persists accepted harvest facts with candidate and model provenance', async () => {
    const store = makeStore()
    const candidate: HarvestCandidate = {
      ...baseCandidate,
      origin: {
        projectKey: '/repo',
        actor: 'main_session',
        sessionId: 'session_1',
        runLoopId: 'run_1',
      },
    }
    const binding = makeBinding('anthropic', 'claude-opus-4-5')
    const enqueued = await enqueueHarvest(candidate, binding, { store, now: () => 40, createId: () => 'job_origin' })

    const completed = await runHarvestJob(enqueued.job!, {
      store,
      distillers: [{ name: 'MemoryCuratorDistiller', distill: async () => memoryEnvelope('Run pnpm build before release.', 'cit_user_run_1', 0.96) }],
      now: () => 50,
    })

    expect(completed.status).toBe('accepted')
    expect(store.facts.at(-1)).toMatchObject({
      origin: {
        projectKey: '/repo',
        actor: 'main_session',
        sessionId: 'session_1',
        runLoopId: 'run_1',
        providerProtocol: 'anthropic',
        modelId: 'claude-opus-4-5',
      },
    })
  })

  it('skips disabled, greeting, acknowledgement, and no-new-fact turns without invoking distillers', async () => {
    const store = makeStore()
    const distiller = { name: 'MemoryCuratorDistiller', distill: vi.fn() }

    const disabled = await enqueueHarvest(baseCandidate, makeBinding('anthropic'), { enabled: false, store, now: () => 1 })
    expect(disabled.status).toBe('skipped')
    expect(disabled.job?.decision).toEqual({ action: 'skip', reason: 'rate_limited' })

    const greeting = await enqueueHarvest({ ...baseCandidate, userMessage: 'hi' }, makeBinding('anthropic'), { store, now: () => 2 })
    expect(greeting.status).toBe('queued')
    const greetingRun = await runHarvestJob(greeting.job!, { store, distillers: [distiller], now: () => 3 })
    expect(greetingRun.status).toBe('skipped')
    expect(greetingRun.job!.decision).toEqual({ action: 'skip', reason: 'greeting_or_smalltalk' })

    const ok = await enqueueHarvest({ ...baseCandidate, userMessage: 'ok' }, makeBinding('openai-chat'), { store, now: () => 4 })
    const okRun = await runHarvestJob(ok.job!, { store, distillers: [distiller], now: () => 5 })
    expect(okRun.status).toBe('skipped')
    expect(okRun.job!.decision).toEqual({ action: 'skip', reason: 'no_new_fact' })
    expect(distiller.distill).not.toHaveBeenCalled()
  })

  it('redacts candidate content before distillation and does not use assistant thinking as durable signal', async () => {
    const store = makeStore()
    const distiller: HarvestDistiller = {
      name: 'MemoryCuratorDistiller',
      distill: async (candidate) => {
        expect(JSON.stringify(candidate)).not.toContain('sk-proj-1234567890abcdef1234567890abcdef')
        return memoryEnvelope('User prefers redacted credentials.', 'cit_user_run_1')
      },
    }

    const secretCandidate = { ...baseCandidate, userMessage: 'Remember token sk-proj-1234567890abcdef1234567890abcdef for later.' }
    const secretJob = await enqueueHarvest(secretCandidate, makeBinding('openai-responses'), { store, now: () => 10 })
    const secretRun = await runHarvestJob(secretJob.job!, { store, distillers: [distiller], now: () => 11 })
    expect(secretRun.status).toBe('accepted')
    expect(JSON.stringify(store.facts)).not.toContain('sk-proj-1234567890abcdef')

    const thinkingOnly = {
      ...baseCandidate,
      userMessage: 'ok',
      assistantMessages: [{ id: 'assistant_thinking', role: 'assistant' as const, content: [{ type: 'thinking' as const, thinking: 'decision: must remember this hidden preference' }], timestamp: 2 }],
    }
    const thinkingJob = await enqueueHarvest(thinkingOnly, makeBinding('anthropic'), { store, now: () => 12 })
    const thinkingRun = await runHarvestJob(thinkingJob.job!, { store, distillers: [distiller], now: () => 13 })
    expect(thinkingRun.status).toBe('skipped')
    expect(thinkingRun.job!.decision).toEqual({ action: 'skip', reason: 'no_new_fact' })
    expect(JSON.stringify(store.rejectedCandidates)).not.toContain('hidden preference')
  })

  it('rejects distiller payloads with untrusted extra fields and records inspectable reasons', async () => {
    const store = makeStore()
    const distiller: HarvestDistiller = {
      name: 'MemoryCuratorDistiller',
      distill: async () => ({
        schemaVersion: 1,
        distiller: 'MemoryCuratorDistiller',
        confidence: 0.92,
        citations: [{ id: 'cit_user_run_1', type: 'message', ref: 'run_1:user' }],
        payload: {
          kind: 'workflow_hint',
          scope: 'project',
          content: 'Use no-file-parallelism for context tests.',
          confidence: 0.92,
          untrustedSummary: 'extra AI-generated payload outside the distiller schema',
        },
      }),
    }

    const enqueued = await enqueueHarvest(baseCandidate, makeBinding('anthropic'), { store, now: () => 30, createId: () => 'job_extra_payload' })
    const completed = await runHarvestJob(enqueued.job!, { store, distillers: [distiller], now: () => 31 })

    expect(completed.status).toBe('rejected')
    expect(store.diagnostics.at(-1)?.message).toContain('payload schema invalid')
    const rejected = store.rejectedCandidates.at(-1)
    expect(rejected?.reason).toBe('Distiller output rejected by schema/citation/confidence/safety validation')
    expect(rejected?.options.validationErrors).toEqual(expect.arrayContaining([expect.stringContaining('payload schema invalid')]))
  })

  it('persists harvest jobs and retained model binding through the real ContextStore API', async () => {
    const store = await openContextStore({ dbPath: makeDbPath(), now: () => 10 })
    const binding = makeBinding('openai-chat', 'runLoop-model')
    const enqueued = await enqueueHarvest(baseCandidate, binding, { store, now: () => 10, createId: () => 'job_store_binding' })
    expect(enqueued.status).toBe('queued')

    const listedQueued = await store.listHarvestJobs('session_1')
    expect(listedQueued.ok).toBe(true)
    expect(listedQueued.value[0]).toMatchObject({ id: 'job_store_binding', status: 'queued', modelBinding: binding })

    const distiller: HarvestDistiller = {
      name: 'MemoryCuratorDistiller',
      distill: async (_candidate, context) => memoryEnvelope(`Using ${context.modelBinding.modelId}`, 'cit_user_run_1'),
    }
    const completed = await runHarvestJob(listedQueued.value[0], { store, distillers: [distiller], now: () => 20 })
    expect(completed.status).toBe('accepted')

    const listedCompleted = await store.listHarvestJobs('session_1')
    expect(listedCompleted.value.at(-1)).toMatchObject({ id: 'job_store_binding', status: 'accepted', modelBinding: binding })
    const facts = await store.queryFacts({ citationRef: 'run_1:user' })
    expect(facts.value[0]).toMatchObject({ content: 'Using runLoop-model', sourceProvider: 'Harvest:MemoryCuratorDistiller' })
  })

  it('runs the default distiller through the captured provider protocol model binding', async () => {
    for (const providerProtocol of ['anthropic', 'openai-chat', 'openai-responses'] as const) {
      const store = makeStore()
      const calls: string[] = []
      const modelClient = makeModelClient(providerProtocol, JSON.stringify(memoryEnvelope(`Model summarized through ${providerProtocol}`, 'cit_user_run_1')), calls)
      const enqueued = await enqueueHarvest(baseCandidate, makeBinding(providerProtocol), { store, now: () => 4_000, createId: () => `job_${providerProtocol}_default` })

      const completed = await runHarvestJob(enqueued.job!, { store, modelClient, now: () => 4_100 })

      expect(completed.status).toBe('accepted')
      expect(calls).toEqual([providerProtocol])
      expect(store.facts.at(-1)).toMatchObject({ content: `Model summarized through ${providerProtocol}`, sourceProvider: 'Harvest:MemoryCuratorDistiller' })
    }
  })

  it('uses the high-confidence default threshold when validating model output', async () => {
    const store = makeStore()
    const enqueued = await enqueueHarvest(baseCandidate, makeBinding('anthropic'), { store, now: () => 4_500, createId: () => 'job_default_min_confidence' })

    const completed = await runHarvestJob(enqueued.job!, {
      store,
      distillers: [{ name: 'MemoryCuratorDistiller', distill: async () => memoryEnvelope('Below the high-confidence auto-accept bar.', 'cit_user_run_1', 0.84) }],
      now: () => 4_600,
    })

    expect(completed.status).toBe('rejected')
    expect(store.facts).toEqual([])
    expect(store.rejectedCandidates.at(-1)?.options.validationErrors).toEqual(expect.arrayContaining([expect.stringContaining('below minimum 0.86')]))
  })

  it('rejects auto-accept when the derived fact confidence falls below the high-confidence threshold', async () => {
    const store = makeStore()
    const enqueued = await enqueueHarvest(baseCandidate, makeBinding('anthropic'), { store, now: () => 4_650, createId: () => 'job_low_payload_confidence' })

    const completed = await runHarvestJob(enqueued.job!, {
      store,
      distillers: [{ name: 'MemoryCuratorDistiller', distill: async () => memoryEnvelope('Payload confidence is below the auto-accept bar.', 'cit_user_run_1', 0.92, 0.84) }],
      now: () => 4_660,
    })

    expect(completed.status).toBe('rejected')
    expect(store.facts).toEqual([])
    expect(store.rejectedCandidates.at(-1)?.options.validationErrors).toEqual(expect.arrayContaining([expect.stringContaining('confidence 0.84 is below minimum 0.86')]))
  })

  it('keeps non-allowlisted fact kinds pending review even in auto-accept trust mode', async () => {
    const store = makeStore()
    const goalCandidate = {
      ...baseCandidate,
      userMessage: 'The current goal is to keep harvest asynchronous after the assistant response completes.',
    }
    const enqueued = await enqueueHarvest(goalCandidate, makeBinding('openai-chat'), { store, now: () => 4_700, createId: () => 'job_review_current_goal' })

    const completed = await runHarvestJob(enqueued.job!, {
      store,
      trustMode: 'auto_accept_high_confidence',
      distillers: [{ name: 'ConversationStateDistiller', distill: async () => conversationEnvelope('Keep harvest asynchronous after assistant response completion.', 'cit_user_run_1') }],
      now: () => 4_800,
    })

    expect(completed.status).toBe('pending_review')
    expect(store.facts).toEqual([])
    expect(store.rejectedCandidates.at(-1)).toMatchObject({
      reason: 'pending_review',
      options: { sessionId: 'session_1', status: 'pending_review' },
    })
    expect(store.jobs.at(-1)).toMatchObject({ status: 'pending_review' })
  })

  it('lets the model return a durable no-op decision without creating primary memory noise', async () => {
    const store = makeStore()
    const calls: string[] = []
    const modelNoop = {
      schemaVersion: 1,
      distiller: 'MemoryCuratorDistiller',
      action: 'skip',
      reason: 'model_noop',
      confidence: 0.94,
    }
    const modelClient = makeModelClient('anthropic', JSON.stringify(modelNoop), calls)
    const enqueued = await enqueueHarvest(baseCandidate, makeBinding('anthropic'), { store, now: () => 5_000, createId: () => 'job_model_noop' })

    const completed = await runHarvestJob(enqueued.job!, { store, modelClient, now: () => 5_100 })

    expect(completed.status).toBe('skipped')
    expect(calls).toEqual(['anthropic'])
    expect(store.facts).toEqual([])
    expect(store.rejectedCandidates).toHaveLength(1)
    expect(store.rejectedCandidates[0]).toMatchObject({
      candidate: { action: 'skip', reason: 'model_noop' },
      reason: 'Harvest model skipped durable storage: model_noop',
      options: { sessionId: 'session_1', validationErrors: ['model_noop'], status: 'rejected', visibleInPrimaryUi: false },
    })
    expect(store.jobs.at(-1)).toMatchObject({ status: 'skipped', decision: { action: 'skip', reason: 'model_noop' } })
  })

  it('treats aborted background harvest as skipped diagnostics instead of rejected memory', async () => {
    const store = makeStore()
    const distiller: HarvestDistiller = {
      name: 'MemoryCuratorDistiller',
      distill: async () => {
        throw new Error('Request was aborted')
      },
    }
    const enqueued = await enqueueHarvest(baseCandidate, makeBinding('openai-responses'), { store, now: () => 6_000, createId: () => 'job_aborted' })

    const completed = await runHarvestJob(enqueued.job!, { store, distillers: [distiller], now: () => 6_100 })

    expect(completed.status).toBe('skipped')
    expect(store.rejectedCandidates).toEqual([])
    expect(store.jobs.at(-1)).toMatchObject({ status: 'skipped', decision: { action: 'skip', reason: 'cancelled' } })
    expect(store.diagnostics.at(-1)?.message).toContain('cancelled')
  })

  it('treats timed-out harvest model calls as quiet skips instead of rejected candidates', async () => {
    const store = makeStore()
    const distiller: HarvestDistiller = {
      name: 'MemoryCuratorDistiller',
      distill: async () => {
        await new Promise(resolve => setTimeout(resolve, 40))
        return memoryEnvelope('This output arrived too late.', 'cit_user_run_1')
      },
    }
    const enqueued = await enqueueHarvest(baseCandidate, makeBinding('openai-responses'), { store, now: () => 6_200, createId: () => 'job_timeout' })

    const completed = await runHarvestJob(enqueued.job!, {
      store,
      distillers: [distiller],
      timeoutMs: 5,
      now: () => 6_300,
    })

    expect(completed.status).toBe('skipped')
    expect(store.facts).toEqual([])
    expect(store.rejectedCandidates).toEqual([])
    expect(store.jobs.at(-1)).toMatchObject({ status: 'skipped', decision: { action: 'skip', reason: 'timeout' } })
    expect(store.diagnostics.at(-1)?.message).toContain('timeout')
  })

  it('treats cancelled harvest model calls as quiet skips instead of rejected candidates', async () => {
    const store = makeStore()
    const controller = new AbortController()
    const distiller: HarvestDistiller = {
      name: 'MemoryCuratorDistiller',
      distill: async () => memoryEnvelope('Cancelled output should not persist.', 'cit_user_run_1'),
    }
    const enqueued = await enqueueHarvest(baseCandidate, makeBinding('anthropic'), { store, now: () => 6_400, createId: () => 'job_cancelled' })
    controller.abort()

    const completed = await runHarvestJob(enqueued.job!, {
      store,
      distillers: [distiller],
      signal: controller.signal,
      now: () => 6_500,
    })

    expect(completed.status).toBe('skipped')
    expect(store.facts).toEqual([])
    expect(store.rejectedCandidates).toEqual([])
    expect(store.jobs.at(-1)).toMatchObject({ status: 'skipped', decision: { action: 'skip', reason: 'cancelled' } })
    expect(store.diagnostics.at(-1)?.message).toContain('cancelled')
  })

  it('defends the durable store boundary against secrets, raw thinking, and fake citations', async () => {
    const store = await openContextStore({ dbPath: makeDbPath(), now: () => 1_000 })
    const secretEvidence: RawEvidence = {
      id: 'evidence_secret',
      sessionId: 'session_1',
      cwd: '/repo',
      sourceProvider: 'TestProvider',
      kind: 'file',
      content: 'api_key=sk-proj-1234567890abcdef1234567890abcdef',
      metadata: { password: 'super-secret-password', file: '.env' },
      capturedAt: 1,
      hash: 'hash_1',
    }

    expect((await store.saveRawEvidence(secretEvidence)).ok).toBe(true)
    const rawEvidence = await store.listRawEvidence('session_1')
    expect(JSON.stringify(rawEvidence.value)).not.toContain('sk-proj-1234567890abcdef')
    expect(JSON.stringify(rawEvidence.value)).not.toContain('super-secret-password')

    const rawThinkingFact = makeFact({ content: 'raw thinking: hidden chain of thought', citations: [{ id: 'cit_msg', type: 'message', ref: 'msg_1' }] })
    const rawThinkingSave = await store.saveFact(rawThinkingFact)
    expect(rawThinkingSave.ok).toBe(false)

    const fakeTaskFact = makeFact({ id: 'fake_task_fact', citations: [{ id: 'cit_task', type: 'task', ref: 'missing_task' }] })
    const fakeTaskSave = await store.saveFact(fakeTaskFact)
    expect(fakeTaskSave.ok).toBe(false)

    await expect(store.rejectCandidate({ token: 'ghp_1234567890abcdefghijklmnopqrstuvwxyz', reasoning: 'hidden chain of thought' }, 'Bearer abcdefghijklmnopqrstuvwxyz123456', { id: 'rejected_secret', sessionId: 'session_1', createdAt: 1 })).resolves.toMatchObject({ ok: true })
    const rejected = await store.listRejectedCandidates({ sessionId: 'session_1', includeExpired: true })
    expect(JSON.stringify(rejected.value)).not.toContain('ghp_1234567890')
    expect(JSON.stringify(rejected.value)).not.toContain('Bearer abcdefghijklmnopqrstuvwxyz')
    expect(JSON.stringify(rejected.value)).not.toContain('hidden chain of thought')
  })
})

function makeBinding(providerProtocol: HarvestModelBinding['providerProtocol'], modelId = 'model_1'): HarvestModelBinding {
  return { sessionId: 'session_1', providerProtocol, modelId, modelConfig: { model: modelId, maxTokens: 1024 }, modelGroupId: 'group_1', baseUrl: 'https://model.local', contextWindow: 128_000 }
}

function memoryEnvelope(content: string, citationId: string, confidence = 0.92, payloadConfidence = confidence): DistillerEnvelope {
  return { schemaVersion: 1, distiller: 'MemoryCuratorDistiller', confidence, citations: [{ id: citationId, type: 'message', ref: 'run_1:user' }], payload: { kind: 'workflow_hint', scope: 'project', content, confidence: payloadConfidence } }
}

function conversationEnvelope(currentGoal: string, citationId: string): DistillerEnvelope {
  return {
    schemaVersion: 1,
    distiller: 'ConversationStateDistiller',
    confidence: 0.92,
    citations: [{ id: citationId, type: 'message', ref: 'run_1:user' }],
    payload: {
      currentGoal,
      activeConstraints: ['Harvest must not run before assistant response completion.'],
      confirmedDecisions: [],
      rejectedDirections: [],
      openQuestions: [],
    },
  }
}

function makeDbPath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'jdc-context-harvest-'))
  tmpDirs.push(dir)
  return path.join(dir, 'jdc-context.db')
}

function makeFact(overrides: Partial<ContextFact> = {}): ContextFact {
  return {
    id: 'fact_1',
    kind: 'workflow_rule',
    scope: 'project',
    content: 'Durable facts require proof-bound citations.',
    citations: [{ id: 'cit_file', type: 'file', ref: 'src/file.ts', hash: 'hash_1' }],
    confidence: 0.9,
    freshness: 'recent',
    sourceProvider: 'TestProvider',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function makeStore(options: { saveFactResult?: { ok: boolean; value: undefined; diagnostics: ContextDiagnostic[] } } = {}): HarvestPersistence & { jobs: HarvestJob[]; diagnostics: ContextDiagnostic[]; facts: ContextFact[]; rejectedCandidates: Array<{ candidate: unknown; reason: string; options: NonNullable<Parameters<NonNullable<HarvestPersistence['rejectCandidate']>>[2]> }> } {
  const jobs: HarvestJob[] = []
  const diagnostics: ContextDiagnostic[] = []
  const facts: ContextFact[] = []
  const rejectedCandidates: Array<{ candidate: unknown; reason: string; options: NonNullable<Parameters<NonNullable<HarvestPersistence['rejectCandidate']>>[2]> }> = []
  return {
    jobs,
    diagnostics,
    facts,
    rejectedCandidates,
    saveRawEvidence: async () => ({ ok: true, value: undefined, diagnostics: [] }),
    saveFact: vi.fn(async (fact: ContextFact) => {
      if (options.saveFactResult) return options.saveFactResult
      facts.push(fact)
      return { ok: true, value: undefined, diagnostics: [] }
    }),
    saveHarvestJob: async (job) => { jobs.push(job); return { ok: true, value: undefined, diagnostics: [] } },
    updateHarvestJob: async (job) => { jobs.push(job); return { ok: true, value: undefined, diagnostics: [] } },
    saveDiagnostic: async (diagnostic) => { diagnostics.push(diagnostic); return { ok: true, value: undefined, diagnostics: [] } },
    rejectCandidate: async (candidate, reason, options = {}) => { rejectedCandidates.push({ candidate, reason, options }); return { ok: true, value: null, diagnostics: [] } },
  }
}

function makeModelClient(expectedProtocol: HarvestModelBinding['providerProtocol'], responseText: string, calls: string[]): DistillerModelClient {
  return {
    completeAnthropicMessages: async () => {
      calls.push('anthropic')
      expect(expectedProtocol).toBe('anthropic')
      return responseText
    },
    completeOpenAIChatCompletions: async () => {
      calls.push('openai-chat')
      expect(expectedProtocol).toBe('openai-chat')
      return responseText
    },
    completeOpenAIResponses: async () => {
      calls.push('openai-responses')
      expect(expectedProtocol).toBe('openai-responses')
      return responseText
    },
  }
}

function diagnostic(message: string): ContextDiagnostic {
  return { id: `diag_${message.replace(/\W+/g, '_')}`, level: 'warning', source: 'TestStore', message, createdAt: 1 }
}
