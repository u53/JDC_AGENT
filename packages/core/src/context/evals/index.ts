import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import initSqlJs from 'sql.js'
import { strict as assert } from 'node:assert'
import { buildContextBundle } from '../orchestrator.js'
import { classifyHarvestCandidate, prepareCandidateForDistillation, rejectUnsafeDurableFact, validateDistillerEnvelopeForAcceptance } from '../safety.js'
import { enqueueHarvest, runHarvestJob } from '../harvest.js'
import { captureHarvestModelBinding } from '../model-binding.js'
import { renderContextBundle } from '../prompt-renderer.js'
import { collectRuntimeContext } from '../providers/runtime-provider.js'
import { DEFAULT_CONTEXT_ENGINE_CONFIG } from '../config.js'
import { CONTEXT_STORE_SCHEMA_VERSION, closeContextStore, openContextStore } from '../store.js'
import { createContextEngineTools } from '../../tools/context-engine-tools.js'
import { getContextEngine } from '../../context-engine/index.js'
import { AnthropicProvider } from '../../providers/anthropic.js'
import { OpenAIChatProvider } from '../../providers/openai-chat.js'
import { OpenAIResponsesProvider } from '../../providers/openai-responses.js'
import type { ContextEvalCase } from './assertions.js'
import {
  makeEvalBundle,
  makeEvalCitation,
  makeEvalDistiller,
  makeEvalFact,
  makeEvalHarvestCandidate,
  makeEvalMemoryEnvelope,
  makeEvalModelBinding,
  makeEvalProvider,
  makeEvalRawEvidence,
  makeEvalRequest,
  makeEvalSection,
  makeEvalStore,
  makeEvalToolContext,
  runContextEvalSuite,
} from './assertions.js'

export async function runGateFContextEvals() {
  return runContextEvalSuite(createGateFContextEvalCases())
}

export function createGateFContextEvalCases(): ContextEvalCase[] {
  return [
    {
      id: 'context-relevant-file-recall',
      category: 'context_quality',
      name: 'Relevant file recall uses the existing JDC tools surface',
      run: async () => {
        const fixture = makeCodeFixture()
        try {
          const tools = Object.fromEntries(createContextEngineTools().map((tool) => [tool.definition.name, tool]))
          const toolContext = await makeIndexedEvalToolContext(fixture.cwd)
          const search = await tools.JdcSearch.execute({ query: 'computeContextBudget' }, toolContext)
          assert.notEqual(search.isError, true)
          assert.match(search.content, /src\/context-budget\.ts/)
          const context = await tools.JdcContext.execute({ task: 'how does planContext use computeContextBudget', maxNodes: 8, includeCode: true }, toolContext)
          assert.match(context.content, /computeContextBudget/)
          assert.match(context.content, /planContext/)
        } finally {
          fixture.cleanup()
        }
      },
    },
    {
      id: 'context-stale-memory-not-live',
      category: 'context_quality',
      name: 'Stale memory is excluded from default injected context',
      run: async () => {
        const stale = makeEvalFact({ id: 'stale_memory', kind: 'user_preference', freshness: 'stale', sourceProvider: 'MemorySignalProvider', content: 'Use the old release checklist.' })
        const report = await buildContextBundle(makeEvalRequest(), { injectionEnabled: true, store: makeEvalStore({ facts: [stale] }), providers: [], now: () => 1, id: () => 'ctx_stale' })
        assert.equal(report.bundle.sections.length, 0)
        assert.doesNotMatch(report.renderedPrompt, /old release checklist/)
        assert.doesNotMatch(report.renderedPrompt, /freshness="live"[^>]*old release checklist/)
      },
    },
    {
      id: 'context-runtime-error-chain',
      category: 'context_quality',
      name: 'Runtime provider explains failed tool chains with citations',
      run: () => {
        const result = collectRuntimeContext(makeEvalRequest({
          runtime: {
            toolEvents: [
              { id: 'tool_read_missing', name: 'Read', status: 'failed', message: 'ENOENT packages/core/src/missing.ts' },
              { id: 'tool_grep_cancelled', name: 'Grep', status: 'cancelled', message: 'cancelled after sibling failure' },
            ],
          },
        }))
        assert.equal(result.health.status, 'enabled')
        assert.equal(result.sections.length, 1)
        assert.match(result.sections[0]!.content, /Read failed/)
        assert.match(result.sections[0]!.content, /Grep cancelled/)
        assert.deepEqual(result.sections[0]!.citations.map((citation) => citation.ref), ['tool_read_missing', 'tool_grep_cancelled'])
      },
    },
    {
      id: 'context-token-budget',
      category: 'context_quality',
      name: 'Context bundle records token usage without local dropping',
      run: async () => {
        const large = makeEvalSection({ id: 'large_context', content: 'x'.repeat(400), tokenEstimate: 100 })
        const small = makeEvalSection({ id: 'small_context', content: 'important runtime evidence', tokenEstimate: 6, priority: 100 })
        const report = await buildContextBundle(makeEvalRequest(), {
          injectionEnabled: true,
          store: makeEvalStore(),
          providers: [makeEvalProvider([small, large])],
          now: () => 1,
          id: () => 'ctx_budget',
        })
        assert.deepEqual(report.bundle.sections.map((section) => section.id), ['small_context', 'large_context'])
        assert.equal(report.bundle.budget.usedTokens, 106)
        assert.equal(report.bundle.budget.maxTokens, undefined)
        assert.equal(report.bundle.budget.droppedTokens, 0)
        assert.deepEqual(report.dropped, [])
      },
    },
    {
      id: 'product-cross-session-project-fact',
      category: 'context_quality',
      name: 'Accepted project facts make the next same-project session better',
      run: async () => {
        const fixture = makeProjectFixture()
        try {
          const storeA = await openContextStore({ cwd: fixture.cwd, now: () => 1_000 })
          assertStoreOk(await storeA.saveRawEvidence(makeEvalRawEvidence({
            id: 'raw_user_rule',
            sessionId: 'session_a',
            cwd: fixture.cwd,
            sourceProvider: 'ProductEval',
            kind: 'message',
            content: '记住这个项目约定：上线前必须跑 pnpm build',
            metadata: { messageId: 'session_a/run_1' },
            capturedAt: 1_000,
            hash: 'hash_user_rule',
          })))
          assertStoreOk(await storeA.saveFact(makeEvalFact({
            id: 'project_convention_build',
            kind: 'project_convention',
            scope: 'project',
            content: '上线前必须跑 pnpm build',
            citations: [makeEvalCitation({ id: 'cit_project_convention', ref: 'session_a/run_1' })],
            confidence: 0.91,
            sourceProvider: 'Harvest:MemoryCuratorDistiller',
            sessionId: 'session_a',
            createdAt: 1_000,
            updatedAt: 1_000,
          })))

          const storeB = await openContextStore({ cwd: fixture.cwd, now: () => 2_000 })
          const report = await buildContextBundle(makeEvalRequest({ cwd: fixture.cwd, sessionId: 'session_b', userMessage: '帮我改一下 UI 文案' }), {
            store: storeB,
            providers: [],
            now: () => 2_000,
            id: () => 'ctx_product_cross_session',
          })

          assert.match(report.renderedPrompt, /上线前必须跑 pnpm build/)
        } finally {
          await closeContextStore({ cwd: fixture.cwd })
          fixture.cleanup()
        }
      },
    },
    {
      id: 'product-model-noop-not-primary-context',
      category: 'context_quality',
      name: 'Model no-op harvest diagnostics are not rendered as durable context',
      run: async () => {
        const fixture = makeProjectFixture()
        try {
          const store = await openContextStore({ cwd: fixture.cwd, now: () => 1_000 })
          assertStoreOk(await store.rejectCandidate(
            { action: 'skip', reason: 'model_noop' },
            'Harvest model skipped durable storage: model_noop',
            { id: 'noop_1', sessionId: 'session_a', createdAt: 1_000, validationErrors: ['model_noop'], status: 'rejected', visibleInPrimaryUi: false },
          ))

          const report = await buildContextBundle(makeEvalRequest({ cwd: fixture.cwd, sessionId: 'session_b', userMessage: '继续' }), {
            store,
            providers: [],
            now: () => 2_000,
            id: () => 'ctx_product_noop',
          })

          assert.equal(report.bundle.sections.length, 0)
          assert.doesNotMatch(report.renderedPrompt, /model_noop/)
        } finally {
          await closeContextStore({ cwd: fixture.cwd })
          fixture.cleanup()
        }
      },
    },
    {
      id: 'product-foreground-context-budget',
      category: 'context_quality',
      name: 'Slow providers degrade quickly instead of blocking foreground context',
      run: async () => {
        const fixture = makeProjectFixture()
        try {
          const store = await openContextStore({ cwd: fixture.cwd, now: () => 1_000 })
          const startedAt = Date.now()
          const report = await buildContextBundle(makeEvalRequest({ cwd: fixture.cwd, userMessage: '修复性能' }), {
            store,
            providers: [{
              id: 'code',
              collect: async () => {
                await new Promise((resolve) => setTimeout(resolve, 250))
                return { evidence: [], sections: [], diagnostics: [], health: { id: 'code', status: 'enabled', updatedAt: 1_000 } }
              },
            }],
            providerTimeoutMs: 80,
            now: () => Date.now(),
            id: () => 'ctx_product_perf',
          })

          assert.ok(Date.now() - startedAt < 220)
          assert.doesNotMatch(report.renderedPrompt, /undefined/)
          assert.equal(report.providerHealth[0]?.status, 'timeout')
        } finally {
          await closeContextStore({ cwd: fixture.cwd })
          fixture.cleanup()
        }
      },
    },
    {
      id: 'store-schema-migration',
      category: 'regression',
      name: 'Context store migrates old schema databases inside the Gate F one-command eval path',
      run: async () => {
        const fixture = makeStoreFixture()
        try {
          await writeEvalDatabase(fixture.dbPath, [
            `CREATE TABLE schema_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
            `INSERT INTO schema_meta(key, value) VALUES('context_schema_version', '0')`,
          ])
          const store = await openContextStore({ dbPath: fixture.dbPath })
          const info = await store.getSchemaInfo()
          assertStoreOk(info)
          assert.equal(info.value.version, CONTEXT_STORE_SCHEMA_VERSION)
          assertStoreOk(await store.saveRawEvidence(makeEvalRawEvidence({ id: 'evidence_after_migration' })))
        } finally {
          fixture.cleanup()
        }
      },
    },
    {
      id: 'store-schema-rebuild',
      category: 'regression',
      name: 'Context store rebuilds unsupported future schemas and keeps a backup',
      run: async () => {
        const fixture = makeStoreFixture()
        try {
          await writeEvalDatabase(fixture.dbPath, [
            `CREATE TABLE schema_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
            `INSERT INTO schema_meta(key, value) VALUES('context_schema_version', '999')`,
          ])
          const store = await openContextStore({ dbPath: fixture.dbPath, now: () => 123_456 })
          const info = await store.getSchemaInfo()
          assertStoreOk(info)
          assert.equal(info.value.version, CONTEXT_STORE_SCHEMA_VERSION)
          assert.equal(info.value.backupPath, `${fixture.dbPath}.backup-123456`)
          assert.equal(existsSync(`${fixture.dbPath}.backup-123456`), true)
          assertStoreOk(await store.saveRawEvidence(makeEvalRawEvidence({ id: 'evidence_after_rebuild' })))
        } finally {
          fixture.cleanup()
        }
      },
    },
    {
      id: 'store-failure-fallback',
      category: 'regression',
      name: 'Context store opening failures return diagnostics and fallback values instead of throwing',
      run: async () => {
        const fixture = makeStoreFixture()
        try {
          mkdirSync(fixture.dbPath)
          const store = await openContextStore({ dbPath: fixture.dbPath })
          const query = await store.queryFacts()
          assert.equal(query.ok, false)
          assert.deepEqual(query.value, [])
          assert.match(query.diagnostics[0]?.message ?? '', /Context store unavailable/)

          const save = await store.saveFact(makeEvalFact({ id: 'fact_not_saved' }))
          assert.equal(save.ok, false)
          assert.equal(save.diagnostics[0]?.source, 'ContextStore')
        } finally {
          fixture.cleanup()
        }
      },
    },
    {
      id: 'store-quota-readiness',
      category: 'regression',
      name: 'Context store quota enforcement trims facts, bundles, raw evidence, and rejected candidates',
      run: async () => {
        const fixture = makeStoreFixture()
        try {
          const store = await openContextStore({
            dbPath: fixture.dbPath,
            now: () => 10_000,
            quotas: { maxFacts: 2, maxBundleSnapshots: 2, maxRejectedCandidates: 2, rawEvidenceTtlMs: 100 },
          })
          assertStoreOk(await store.saveRawEvidence(makeEvalRawEvidence({ id: 'evidence_file_1', kind: 'file', metadata: { file: 'src/eval.ts' }, hash: 'hash_eval_file' })))

          assertStoreOk(await store.saveFact(makeEvalFact({ id: 'fact_keep_high', citations: [{ id: 'cit_eval_file_high', type: 'file', ref: 'src/eval.ts', hash: 'hash_eval_file' }], confidence: 0.95, updatedAt: 20 })))
          assertStoreOk(await store.saveFact(makeEvalFact({ id: 'fact_drop_low', citations: [{ id: 'cit_eval_file_low', type: 'file', ref: 'src/eval.ts', hash: 'hash_eval_file' }], confidence: 0.81, updatedAt: 30 })))
          assertStoreOk(await store.saveFact(makeEvalFact({ id: 'fact_keep_fresh', citations: [{ id: 'cit_eval_file_fresh', type: 'file', ref: 'src/eval.ts', hash: 'hash_eval_file' }], confidence: 0.82, updatedAt: 40 })))

          assertStoreOk(await store.saveBundleSnapshot(makeEvalBundle({ id: 'bundle_drop', createdAt: 1 })))
          assertStoreOk(await store.saveBundleSnapshot(makeEvalBundle({ id: 'bundle_keep_1', createdAt: 2 })))
          assertStoreOk(await store.saveBundleSnapshot(makeEvalBundle({ id: 'bundle_keep_2', createdAt: 3 })))

          assertStoreOk(await store.saveRawEvidence(makeEvalRawEvidence({ id: 'raw_expired', capturedAt: 9_000 })))
          assertStoreOk(await store.saveRawEvidence(makeEvalRawEvidence({ id: 'raw_keep', capturedAt: 9_950 })))

          assertStoreOk(await store.rejectCandidate({ id: 'candidate_drop_by_count' }, 'low confidence', { id: 'rejected_drop_count', sessionId: 'session_eval', createdAt: 1, ttlMs: 10_000 }))
          assertStoreOk(await store.rejectCandidate({ id: 'candidate_keep_1' }, 'missing citation', { id: 'rejected_keep_1', sessionId: 'session_eval', createdAt: 2, ttlMs: 10_000 }))
          assertStoreOk(await store.rejectCandidate({ id: 'candidate_keep_2' }, 'duplicate', { id: 'rejected_keep_2', sessionId: 'session_eval', createdAt: 3, ttlMs: 10_000 }))

          const quota = await store.enforceQuotas()
          assertStoreOk(quota)
          assert.deepEqual(quota.value, { deletedFacts: 1, deletedBundles: 1, deletedRawEvidence: 2, deletedRejectedCandidates: 1 })
          assert.deepEqual((await store.queryFacts()).value.map((fact) => fact.id), ['fact_keep_high', 'fact_keep_fresh'])
          assert.deepEqual((await store.listBundleSnapshots()).value.map((bundle) => bundle.id), ['bundle_keep_1', 'bundle_keep_2'])
          assert.deepEqual((await store.listRawEvidence()).value.map((evidence) => evidence.id), ['raw_keep'])
          assert.deepEqual((await store.listRejectedCandidates()).value.map((candidate) => candidate.id), ['rejected_keep_1', 'rejected_keep_2'])
        } finally {
          fixture.cleanup()
        }
      },
    },
    {
      id: 'regression-jdc-tools',
      category: 'regression',
      name: 'Existing Jdc* code tools still work with the context eval fixture',
      run: async () => {
        const fixture = makeCodeFixture()
        try {
          const tools = Object.fromEntries(createContextEngineTools().map((tool) => [tool.definition.name, tool]))
          const context = await makeIndexedEvalToolContext(fixture.cwd)
          const search = await tools.JdcSearch.execute({ query: 'planContext' }, context)
          const callers = await tools.JdcCallers.execute({ symbol: 'computeContextBudget' }, context)
          const node = await tools.JdcNode.execute({ symbol: 'planContext', includeCode: true }, context)
          const trace = await tools.JdcTrace.execute({ from: 'planContext', to: 'computeContextBudget' }, context)
          const files = await tools.JdcFiles.execute({ path: 'src' }, context)
          for (const result of [search, callers, node, trace, files]) assert.notEqual(result.isError, true)
          assert.match(search.content, /planContext/)
          assert.match(callers.content, /planContext/)
          assert.match(node.content, /function planContext/)
          assert.match(trace.content, /computeContextBudget/)
          assert.match(files.content, /src\/context-budget\.ts/)
        } finally {
          fixture.cleanup()
        }
      },
    },
    {
      id: 'regression-model-protocols',
      category: 'regression',
      name: 'Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses retain context protocol content',
      run: () => {
        const prompt = '<jdc-context-engine bundle="ctx_eval"><section kind="runtime_state" confidence="0.9" freshness="live" source="Eval">Runtime evidence</section></jdc-context-engine>'
        const user = { id: 'msg_user', role: 'user' as const, content: [{ type: 'text' as const, text: 'use the context bundle' }], timestamp: 1 }
        const toolUse = { id: 'msg_tool_use', role: 'assistant' as const, content: [{ type: 'tool_use' as const, id: 'call_1', name: 'Read', input: { file_path: 'x.ts' } }], timestamp: 2 }
        const toolResultWithText = { id: 'msg_tool_result', role: 'user' as const, content: [{ type: 'tool_result' as const, tool_use_id: 'call_1', content: 'result' }, { type: 'text' as const, text: 'follow up survives' }], timestamp: 3 }

        const anthropic = new AnthropicProvider('test-key') as any
        const anthropicFormatted = anthropic.formatMessages([user, toolUse, toolResultWithText])
        assert.match(JSON.stringify(anthropicFormatted), /follow up survives/)

        const openaiChat = new OpenAIChatProvider('test-key') as any
        const chatFormatted = openaiChat.formatMessages([user, toolUse, toolResultWithText], prompt)
        assert.equal(chatFormatted[0].role, 'system')
        assert.match(String(chatFormatted[0].content), /<jdc-context-engine bundle="ctx_eval">/)
        assert.match(JSON.stringify(chatFormatted), /follow up survives/)

        const responses = new OpenAIResponsesProvider('test-key') as any
        const responsesFormatted = responses.formatInput([user, toolUse, toolResultWithText])
        assert.match(JSON.stringify(responsesFormatted), /function_call_output/)
        assert.match(JSON.stringify(responsesFormatted), /follow up survives/)
      },
    },
    {
      id: 'feature-disable-fallback',
      category: 'feature_flags',
      name: 'Context injection and harvest can be disabled without breaking inspection or tools',
      run: async () => {
        assert.equal(DEFAULT_CONTEXT_ENGINE_CONFIG.injectionEnabled, true)
        assert.equal(DEFAULT_CONTEXT_ENGINE_CONFIG.harvestEnabled, true)
        const store = makeEvalStore()
        const disabledBundle = await buildContextBundle(makeEvalRequest(), { injectionEnabled: false, store, providers: [makeEvalProvider([makeEvalSection()])], now: () => 1, id: () => 'ctx_disabled' })
        assert.equal(disabledBundle.renderedPrompt, '')
        assert.equal(disabledBundle.bundle.sections.length, 0)
        assert.match(disabledBundle.bundle.diagnostics[0]?.message ?? '', /context injection disabled/)

        const enqueued = await enqueueHarvest(makeEvalHarvestCandidate(), makeEvalModelBinding('openai-chat'), { enabled: false, store, now: () => 1, createId: () => 'harvest_disabled' })
        assert.equal(enqueued.status, 'skipped')
        assert.deepEqual(enqueued.job?.decision, { action: 'skip', reason: 'rate_limited' })
      },
    },
    {
      id: 'safety-durable-citations',
      category: 'safety',
      name: 'No durable fact or distiller output is accepted without valid citations',
      run: () => {
        const uncitedFact = rejectUnsafeDurableFact(makeEvalFact({ citations: [] }))
        assert.equal(uncitedFact.accepted, false)
        assert.match(uncitedFact.errors.join('\n'), /durable context requires at least one citation/)

        const fakeCitation = rejectUnsafeDurableFact(makeEvalFact({ citations: [makeEvalCitation({ id: 'missing', ref: 'missing_msg' })] }), { citationSources: { messages: [] } })
        assert.equal(fakeCitation.accepted, false)
        assert.match(fakeCitation.errors.join('\n'), /missing message/)

        const accepted = rejectUnsafeDurableFact(makeEvalFact(), { citationSources: { messages: [{ id: 'msg_eval_user' }] } })
        assert.equal(accepted.accepted, true)

        const uncitedEnvelope = validateDistillerEnvelopeForAcceptance(makeEvalMemoryEnvelope({ citations: [] }), { citationSources: { messages: [{ id: 'run_eval:user' }] } })
        assert.equal(uncitedEnvelope.accepted, false)
      },
    },
    {
      id: 'safety-no-raw-thinking-persistence',
      category: 'safety',
      name: 'Raw model thinking is neither durable evidence nor persisted harvest content',
      run: async () => {
        const candidate = makeEvalHarvestCandidate({
          userMessage: 'ok',
          assistantMessages: [{ id: 'assistant_thinking', role: 'assistant', content: [{ type: 'thinking', thinking: 'raw thinking: store this hidden preference' }], timestamp: 2 }],
        })
        assert.deepEqual(classifyHarvestCandidate(candidate), { action: 'skip', reason: 'no_new_fact' })
        assert.equal(rejectUnsafeDurableFact(makeEvalFact({ content: 'raw thinking: hidden chain of thought' })).accepted, false)

        const store = makeEvalStore()
        const enqueued = await enqueueHarvest(candidate, makeEvalModelBinding('anthropic'), { store, now: () => 1, createId: () => 'harvest_thinking' })
        const run = await runHarvestJob(enqueued.job!, { store, distillers: [makeEvalDistiller(makeEvalMemoryEnvelope())], now: () => 2 })
        assert.equal(run.status, 'skipped')
        assert.doesNotMatch(JSON.stringify(store.rejectedCandidates), /hidden preference/)
      },
    },
    {
      id: 'safety-greeting-no-new-fact-skip',
      category: 'safety',
      name: 'Greeting and no-new-fact turns do not harvest',
      run: async () => {
        const store = makeEvalStore()
        const distiller = makeEvalDistiller(() => { throw new Error('distiller must not run for skipped turns') })
        for (const [message, reason] of [['hi', 'greeting_or_smalltalk'], ['ok', 'no_new_fact'], ['continue', 'no_new_fact']] as const) {
          const enqueued = await enqueueHarvest(makeEvalHarvestCandidate({ userMessage: message }), makeEvalModelBinding('openai-chat'), { store, now: () => 1 })
          const result = await runHarvestJob(enqueued.job!, { store, distillers: [distiller], now: () => 2 })
          assert.equal(result.status, 'skipped')
          assert.deepEqual(result.job?.decision, { action: 'skip', reason })
        }
      },
    },
    {
      id: 'safety-redaction-before-distillation',
      category: 'safety',
      name: 'Secrets are redacted before distillation and never appear in rendered context',
      run: async () => {
        const secret = 'sk-proj-1234567890abcdef1234567890abcdef'
        const prepared = prepareCandidateForDistillation(makeEvalHarvestCandidate({ userMessage: `Remember token ${secret} for this repo.` }))
        assert.equal(prepared.redaction.redacted, true)
        assert.doesNotMatch(JSON.stringify(prepared.candidate), new RegExp(secret))

        const store = makeEvalStore()
        const distiller = makeEvalDistiller((candidate) => {
          assert.doesNotMatch(JSON.stringify(candidate), new RegExp(secret))
          return makeEvalMemoryEnvelope({ payload: { kind: 'workflow_hint', scope: 'project', content: 'Credential was redacted before distillation.', confidence: 0.9 } })
        })
        const enqueued = await enqueueHarvest(makeEvalHarvestCandidate({ userMessage: `Remember token ${secret} for this repo.` }), makeEvalModelBinding('openai-responses'), { store, now: () => 1, createId: () => 'harvest_redaction' })
        const result = await runHarvestJob(enqueued.job!, { store, distillers: [distiller], now: () => 2 })
        assert.equal(result.status, 'accepted')

        const rendered = renderContextBundle(makeEvalStoreBundleWithSecret(secret), { injectionEnabled: true })
        assert.doesNotMatch(rendered, new RegExp(secret))
        assert.match(rendered, /\[redacted secret\]/)
      },
    },
  ]
}

function makeCodeFixture(): { cwd: string; cleanup: () => void } {
  const cwd = mkdtempSync(path.join(tmpdir(), 'jdc-context-evals-'))
  mkdirSync(path.join(cwd, 'src'), { recursive: true })
  writeFileSync(path.join(cwd, 'src', 'context-budget.ts'), 'export function computeContextBudget(tokens: number) { return Math.max(0, tokens - 128) }\n')
  writeFileSync(path.join(cwd, 'src', 'planner.ts'), "import { computeContextBudget } from './context-budget'\nexport function planContext(tokens: number) { return computeContextBudget(tokens) }\n")
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) }
}

async function makeIndexedEvalToolContext(cwd: string) {
  const engine = getContextEngine(cwd)
  await engine.index()
  return Object.assign(makeEvalToolContext(cwd), { contextEngine: engine })
}

function makeStoreFixture(): { dbPath: string; cleanup: () => void } {
  const cwd = mkdtempSync(path.join(tmpdir(), 'jdc-context-store-eval-'))
  return { dbPath: path.join(cwd, 'jdc-context.db'), cleanup: () => rmSync(cwd, { recursive: true, force: true }) }
}

function makeProjectFixture(): { cwd: string; cleanup: () => void } {
  const cwd = mkdtempSync(path.join(tmpdir(), 'jdc-context-product-eval-'))
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) }
}

async function writeEvalDatabase(dbPath: string, statements: string[]): Promise<void> {
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  for (const statement of statements) db.run(statement)
  writeFileSync(dbPath, Buffer.from(db.export()))
  db.close()
}

function assertStoreOk<T>(result: { ok: boolean; value: T; diagnostics: unknown[] }): asserts result is { ok: true; value: T; diagnostics: [] } {
  assert.equal(result.ok, true)
  assert.deepEqual(result.diagnostics, [])
}

function makeEvalStoreBundleWithSecret(secret: string) {
  return {
    id: 'ctx_secret_render',
    sessionId: 'session_eval',
    requestHash: 'hash_secret_render',
    createdAt: 1,
    sections: [makeEvalSection({ id: 'secret_section', content: `token=${secret}`, citations: [makeEvalCitation({ id: 'cit_secret', type: 'message', ref: 'msg_eval_user' })] })],
    citations: [makeEvalCitation({ id: 'cit_secret', type: 'message', ref: 'msg_eval_user' })],
    diagnostics: [],
    budget: { usedTokens: 5, droppedTokens: 0 },
  }
}

export * from './assertions.js'
