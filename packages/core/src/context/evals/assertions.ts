import type { ContextStore } from '../store.js'
import type { HarvestDistiller } from '../harvest.js'
import type {
  ContextBundle,
  ContextCitation,
  ContextFact,
  ContextRequest,
  ContextSection,
  DistillerEnvelope,
  HarvestCandidate,
  HarvestJob,
  HarvestModelBinding,
  RawEvidence,
} from '../types.js'
import type { Message } from '../../types.js'
import type { ContextProvider } from '../orchestrator.js'
import type { ToolContext } from '../../tool-registry.js'

export const GATE_F_CONTEXT_EVAL_COMMAND = 'pnpm --filter @jdcagnet/core exec vitest run src/context/context-evals.test.ts src/context/context-product-evals.test.ts src/context/store.test.ts src/tools/__tests__/context-engine-tools.test.ts tests/anthropic.test.ts tests/openai-chat.test.ts tests/openai-responses.test.ts src/session-context.test.ts src/context/context-harvest.test.ts src/context/context-redaction.test.ts src/context/context-safety.test.ts --no-file-parallelism'

export type ContextEvalCategory = 'context_quality' | 'regression' | 'safety' | 'feature_flags'

export interface ContextEvalCase {
  id: string
  name: string
  category: ContextEvalCategory
  run: () => Promise<void> | void
}

export interface ContextEvalCaseResult {
  id: string
  name: string
  category: ContextEvalCategory
  status: 'passed' | 'failed'
  durationMs: number
  errors: string[]
}

export interface ContextEvalReport {
  gate: 'Gate F Production Candidate'
  command: string
  createdAt: string
  summary: {
    total: number
    passed: number
    failed: number
  }
  cases: ContextEvalCaseResult[]
}

export interface EvalStoreOptions {
  facts?: ContextFact[]
  rawEvidence?: RawEvidence[]
  harvestJobs?: HarvestJob[]
  bundles?: ContextBundle[]
}

export function makeEvalCitation(overrides: Partial<ContextCitation> = {}): ContextCitation {
  return {
    id: 'cit_eval_message',
    type: 'message',
    ref: 'msg_eval_user',
    timestamp: 1,
    ...overrides,
  }
}

export function makeEvalMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg_eval_user',
    role: 'user',
    content: [{ type: 'text', text: 'Remember that JDC Context Engine production facts require citations.' }],
    timestamp: 1,
    ...overrides,
  }
}

export function makeEvalRequest(overrides: Partial<ContextRequest> = {}): ContextRequest {
  return {
    sessionId: 'session_eval',
    cwd: process.cwd(),
    userMessage: 'Fix the context runtime failure in packages/core/src/context/orchestrator.ts',
    recentMessages: [makeEvalMessage()],
    mode: 'code_edit',
    model: 'eval-model',
    tokenBudget: 400,
    runtime: {},
    createdAt: 1_000,
    ...overrides,
  }
}

export function makeEvalFact(overrides: Partial<ContextFact> = {}): ContextFact {
  return {
    id: 'fact_eval',
    kind: 'workflow_rule',
    scope: 'project',
    content: 'Durable JDC Context Engine facts require citations.',
    citations: [makeEvalCitation()],
    confidence: 0.9,
    freshness: 'recent',
    sourceProvider: 'EvalProvider',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

export function makeEvalSection(overrides: Partial<ContextSection> = {}): ContextSection {
  return {
    id: 'section_eval',
    kind: 'runtime_state',
    title: 'Runtime state',
    content: 'Read failed with ENOENT, causing sibling tool calls to be cancelled.',
    citations: [makeEvalCitation({ id: 'cit_eval_tool', type: 'tool_event', ref: 'tool_eval_failed' })],
    priority: 90,
    confidence: 0.9,
    freshness: 'live',
    sourceProvider: 'EvalProvider',
    tokenEstimate: 20,
    ...overrides,
  }
}

export function makeEvalRawEvidence(overrides: Partial<RawEvidence> = {}): RawEvidence {
  return {
    id: 'raw_eval',
    sessionId: 'session_eval',
    cwd: process.cwd(),
    sourceProvider: 'EvalProvider',
    kind: 'message',
    content: 'User asked for citation-backed durable facts.',
    metadata: { messageId: 'msg_eval_user' },
    capturedAt: 1,
    hash: 'hash_eval',
    ...overrides,
  }
}

export function makeEvalBundle(overrides: Partial<ContextBundle> = {}): ContextBundle {
  return {
    id: 'ctx_eval',
    sessionId: 'session_eval',
    requestHash: 'request_hash_eval',
    createdAt: 1,
    sections: [],
    citations: [],
    diagnostics: [],
    budget: { maxTokens: 400, usedTokens: 0, droppedTokens: 0 },
    ...overrides,
  }
}

export function makeEvalHarvestCandidate(overrides: Partial<HarvestCandidate> = {}): HarvestCandidate {
  return {
    sessionId: 'session_eval',
    runLoopId: 'run_eval',
    userMessage: 'Remember that Gate F evals must stay one-command runnable.',
    assistantMessages: [makeEvalMessage({ id: 'assistant_eval', role: 'assistant', content: [{ type: 'text', text: 'Noted.' }], timestamp: 2 })],
    toolEvents: [],
    changedFiles: [],
    createdAt: 1,
    ...overrides,
  }
}

export function makeEvalModelBinding(providerProtocol: HarvestModelBinding['providerProtocol'] = 'anthropic', overrides: Partial<HarvestModelBinding> = {}): HarvestModelBinding {
  return {
    sessionId: 'session_eval',
    providerProtocol,
    modelId: `${providerProtocol}-eval-model`,
    modelConfig: { model: `${providerProtocol}-eval-model`, maxTokens: 1024, contextWindow: 64_000 },
    modelGroupId: 'eval-group',
    baseUrl: 'https://models.eval.local',
    contextWindow: 64_000,
    ...overrides,
  }
}

export function makeEvalMemoryEnvelope(overrides: Partial<DistillerEnvelope> = {}): DistillerEnvelope {
  return {
    schemaVersion: 1,
    distiller: 'MemoryCuratorDistiller',
    confidence: 0.9,
    citations: [makeEvalCitation({ id: 'cit_eval_user', ref: 'run_eval:user' })],
    payload: {
      kind: 'workflow_hint',
      scope: 'project',
      content: 'Gate F evals must stay one-command runnable.',
      confidence: 0.9,
    },
    ...overrides,
  }
}

export function makeEvalDistiller(envelope: DistillerEnvelope | ((candidate: HarvestCandidate, binding: HarvestModelBinding) => DistillerEnvelope | Promise<DistillerEnvelope>)): HarvestDistiller {
  return {
    name: typeof envelope === 'function' ? 'MemoryCuratorDistiller' : String(envelope.distiller),
    distill: async (candidate, context) => typeof envelope === 'function' ? envelope(candidate, context.modelBinding) : envelope,
  }
}

export function makeEvalProvider(sections: ContextSection[], evidence: RawEvidence[] = []): ContextProvider {
  return {
    id: 'runtime',
    collect: async () => ({
      evidence,
      sections,
      diagnostics: [],
      health: { id: 'runtime', status: 'enabled', updatedAt: 1 },
    }),
  }
}

export function makeEvalStore(options: EvalStoreOptions = {}): ContextStore & {
  savedFacts: ContextFact[]
  savedHarvestJobs: HarvestJob[]
  updatedHarvestJobs: HarvestJob[]
  savedBundles: ContextBundle[]
  savedRawEvidence: RawEvidence[]
  rejectedCandidates: Array<{ candidate: unknown; reason: string; options: unknown }>
} {
  const savedFacts: ContextFact[] = []
  const savedHarvestJobs = [...(options.harvestJobs ?? [])]
  const updatedHarvestJobs: HarvestJob[] = []
  const savedBundles = [...(options.bundles ?? [])]
  const savedRawEvidence = [...(options.rawEvidence ?? [])]
  const rejectedCandidates: Array<{ candidate: unknown; reason: string; options: unknown }> = []

  return {
    savedFacts,
    savedHarvestJobs,
    updatedHarvestJobs,
    savedBundles,
    savedRawEvidence,
    rejectedCandidates,
    saveRawEvidence: async (evidence) => { savedRawEvidence.push(evidence); return { ok: true, value: undefined, diagnostics: [] } },
    saveFact: async (fact) => { savedFacts.push(fact); return { ok: true, value: undefined, diagnostics: [] } },
    saveHarvestJob: async (job) => { savedHarvestJobs.push(job); return { ok: true, value: undefined, diagnostics: [] } },
    updateHarvestJob: async (job) => { updatedHarvestJobs.push(job); return { ok: true, value: undefined, diagnostics: [] } },
    listHarvestJobs: async (sessionId) => ({ ok: true, value: savedHarvestJobs.filter((job) => !sessionId || job.sessionId === sessionId), diagnostics: [] }),
    rejectCandidate: async (candidate, reason, rejectOptions = {}) => { rejectedCandidates.push({ candidate, reason, options: rejectOptions }); return { ok: true, value: null, diagnostics: [] } },
    saveBundleSnapshot: async (bundle) => { savedBundles.push(bundle); return { ok: true, value: undefined, diagnostics: [] } },
    saveDiagnostic: async () => ({ ok: true, value: undefined, diagnostics: [] }),
    queryFacts: async (query = {}) => {
      let facts = options.facts ?? []
      if (query.scope) facts = facts.filter((fact) => fact.scope === query.scope)
      if (query.freshness) facts = facts.filter((fact) => fact.freshness === query.freshness)
      if (query.minConfidence !== undefined) facts = facts.filter((fact) => fact.confidence >= query.minConfidence!)
      if (query.citationRef) facts = facts.filter((fact) => fact.citations.some((citation) => citation.ref === query.citationRef))
      if (query.citationType) facts = facts.filter((fact) => fact.citations.some((citation) => citation.type === query.citationType))
      return { ok: true, value: facts, diagnostics: [] }
    },
    listAcceptedProjectFacts: async (query = {}) => {
      let facts = (options.facts ?? []).filter((fact) => fact.scope === 'project' || fact.scope === 'repo' || fact.scope === 'global')
      if (query.freshness) facts = facts.filter((fact) => fact.freshness === query.freshness)
      if (query.minConfidence !== undefined) facts = facts.filter((fact) => fact.confidence >= query.minConfidence!)
      if (query.citationRef) facts = facts.filter((fact) => fact.citations.some((citation) => citation.ref === query.citationRef))
      if (query.citationType) facts = facts.filter((fact) => fact.citations.some((citation) => citation.type === query.citationType))
      return { ok: true, value: facts, diagnostics: [] }
    },
    listAdvancedDiagnostics: async () => ({ ok: true, value: { rejected: [], diagnostics: [], harvestJobs: [] }, diagnostics: [] }),
    invalidateByFileHash: async () => ({ ok: true, value: { invalidatedFacts: 0 }, diagnostics: [] }),
    enforceQuotas: async () => ({ ok: true, value: { deletedFacts: 0, deletedBundles: 0, deletedRawEvidence: 0, deletedRejectedCandidates: 0 }, diagnostics: [] }),
    getSchemaInfo: async () => ({ ok: true, value: { version: 1, dbPath: '/tmp/eval-context.db' }, diagnostics: [] }),
    listBundleSnapshots: async (sessionId) => ({ ok: true, value: savedBundles.filter((bundle) => !sessionId || bundle.sessionId === sessionId), diagnostics: [] }),
    listRawEvidence: async (sessionId) => ({ ok: true, value: savedRawEvidence.filter((evidence) => !sessionId || evidence.sessionId === sessionId), diagnostics: [] }),
    listRejectedCandidates: async () => ({ ok: true, value: [], diagnostics: [] }),
    listDiagnostics: async () => ({ ok: true, value: [], diagnostics: [] }),
    approvePendingCandidate: async () => ({ ok: true, value: null, diagnostics: [] }),
    rejectPendingCandidate: async () => ({ ok: true, value: null, diagnostics: [] }),
  }
}

export function makeEvalToolContext(cwd: string): ToolContext {
  return { cwd, turnIndex: 0 } as ToolContext
}

export async function runContextEvalSuite(cases: ContextEvalCase[]): Promise<ContextEvalReport> {
  const results: ContextEvalCaseResult[] = []
  for (const testCase of cases) {
    const startedAt = Date.now()
    try {
      await testCase.run()
      results.push({ id: testCase.id, name: testCase.name, category: testCase.category, status: 'passed', durationMs: Date.now() - startedAt, errors: [] })
    } catch (error) {
      results.push({ id: testCase.id, name: testCase.name, category: testCase.category, status: 'failed', durationMs: Date.now() - startedAt, errors: [error instanceof Error ? error.message : String(error)] })
    }
  }

  const passed = results.filter((result) => result.status === 'passed').length
  return {
    gate: 'Gate F Production Candidate',
    command: GATE_F_CONTEXT_EVAL_COMMAND,
    createdAt: new Date().toISOString(),
    summary: { total: results.length, passed, failed: results.length - passed },
    cases: results,
  }
}

export function assertContextEvalReportPassed(report: ContextEvalReport): void {
  if (report.summary.failed === 0) return
  const failures = report.cases
    .filter((result) => result.status === 'failed')
    .map((result) => `${result.id}: ${result.errors.join('; ')}`)
    .join('\n')
  throw new Error(`JDC Context Engine Gate F evals failed:\n${failures}`)
}

export function formatContextEvalReport(report: ContextEvalReport): string {
  const lines = [
    `# ${report.gate}`,
    `Command: ${report.command}`,
    `Summary: ${report.summary.passed}/${report.summary.total} passed`,
    '',
    '| Case | Category | Status | Duration |',
    '| --- | --- | --- | ---: |',
    ...report.cases.map((result) => `| ${result.id} | ${result.category} | ${result.status} | ${result.durationMs}ms |`),
  ]
  const failures = report.cases.filter((result) => result.status === 'failed')
  if (failures.length) {
    lines.push('', '## Failures')
    for (const failure of failures) lines.push(`- ${failure.id}: ${failure.errors.join('; ')}`)
  }
  return lines.join('\n')
}
