import type { ActorContextProfile, ContextDiagnostic, ContextEvidenceRequirement, ContextFact, ContextFactKind, ContextFactStatus, ContextRequest } from './types.js'
import type { ContextStore } from './store.js'
import type { ContextPerformanceRecorder } from './performance.js'

const HIGH_VALUE_KINDS = new Set<ContextFactKind>([
  'workflow_rule',
  'project_convention',
  'architecture_decision',
  'known_issue',
  'current_goal',
  'runtime_error_chain',
  'code_entrypoint',
  'team_decision',
  'task_result',
  'artifact_summary',
  'qa_issue',
])

export interface RetrievedContextFact {
  fact: ContextFact
  score: number
  reasons: string[]
}

export interface ContextRetrievalResult {
  facts: RetrievedContextFact[]
  diagnostics: ContextDiagnostic[]
  unavailable?: boolean
}

export interface ContextRetrievalOptions {
  store: Pick<ContextStore, 'listAcceptedProjectFacts'>
  limit?: number
  candidateLimit?: number
  minConfidence?: number
  citationRef?: string
  citationType?: string
  citationTextLookup?: Map<string, string[]>
  actorProfile?: ActorContextProfile
  includeInactive?: boolean
  status?: ContextFactStatus
  recorder?: ContextPerformanceRecorder
  projectKey?: string
  evidenceRequirements?: ContextEvidenceRequirement[]
  now?: () => number
}

export async function retrieveContextFacts(request: ContextRequest, options: ContextRetrievalOptions): Promise<ContextRetrievalResult> {
  const now = options.now ?? Date.now
  const startedAt = now()
  const diagnostics: ContextDiagnostic[] = []
  let candidateCount = 0
  let returnedCount = 0
  let queryPresent = false
  try {
    const query = normalizeSearchText([request.userMessage, request.mode, options.actorProfile?.objective].filter(Boolean).join(' '))
    queryPresent = Boolean(query)
    const storeQuery = {
      minConfidence: options.minConfidence ?? 0.01,
      includeStale: true,
      includeExpired: false,
      orderBy: 'updated_desc' as const,
      ...(options.includeInactive === undefined ? {} : { includeInactive: options.includeInactive }),
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.citationRef === undefined ? {} : { citationRef: options.citationRef }),
      ...(options.citationType === undefined ? {} : { citationType: options.citationType }),
      ...(options.candidateLimit === undefined ? {} : { limit: options.candidateLimit }),
    }
    const loaded = await options.store.listAcceptedProjectFacts(storeQuery)
    if (!loaded.ok) {
      options.recorder?.record({
        name: 'context:retrieve-facts',
        lane: 'foreground',
        status: 'failed',
        startedAt,
        completedAt: now(),
        projectKey: options.projectKey ?? request.cwd,
        metadata: { candidateCount, returnedCount, queryPresent },
        diagnostic: loaded.diagnostics.map((diagnostic) => diagnostic.message).join('; ') || 'context fact retrieval unavailable',
      })
      return { facts: [], diagnostics: loaded.diagnostics, unavailable: true }
    }
    candidateCount = loaded.value.length

    const requirements = options.evidenceRequirements ?? request.evidenceRequirements ?? []
    const scored = loaded.value
      .map((fact) => scoreFact(fact, query, now, options.citationTextLookup, options.actorProfile, requirements))
      .filter((item) => {
        if (!options.includeInactive && isInactiveLifecycleFact(item.fact)) {
          diagnostics.push(makeDiagnostic(`Suppressed inactive lifecycle fact ${item.fact.id}.`, now()))
          return false
        }
        const actorSuppression = suppressForActor(item.fact, options.actorProfile)
        if (actorSuppression) {
          diagnostics.push(makeDiagnostic(actorSuppression, now()))
          return false
        }
        if (item.fact.freshness === 'stale' && !isHighValueStaleFact(item.fact)) {
          diagnostics.push(makeDiagnostic(`Suppressed stale low-value fact ${item.fact.id}.`, now()))
          return false
        }
        if (!query) return true
        return item.score > 0 && (item.reasons.length > 0 || HIGH_VALUE_KINDS.has(item.fact.kind))
      })
      .sort(compareRetrievedFacts)

    const explicitLimit = options.limit ?? options.actorProfile?.preferredFactCount
    const facts = explicitLimit === undefined ? scored : scored.slice(0, explicitLimit)
    returnedCount = facts.length
    options.recorder?.record({
      name: 'context:retrieve-facts',
      lane: 'foreground',
      status: 'success',
      startedAt,
      completedAt: now(),
      projectKey: options.projectKey ?? request.cwd,
      metadata: { candidateCount, returnedCount, queryPresent },
    })
    return { facts, diagnostics: [...loaded.diagnostics, ...diagnostics] }
  } catch (error) {
    options.recorder?.record({
      name: 'context:retrieve-facts',
      lane: 'foreground',
      status: 'failed',
      startedAt,
      completedAt: now(),
      projectKey: options.projectKey ?? request.cwd,
      metadata: { candidateCount, returnedCount, queryPresent },
      diagnostic: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

function scoreFact(fact: ContextFact, query: string, now: () => number, citationTextLookup: Map<string, string[]> | undefined, actorProfile: ActorContextProfile | undefined, evidenceRequirements: ContextEvidenceRequirement[]): RetrievedContextFact {
  const reasons: string[] = []
  let score = 0

  if (HIGH_VALUE_KINDS.has(fact.kind)) {
    score += 8
    reasons.push('high_value_kind')
  }
  score += Math.max(0, Math.min(1, fact.confidence)) * 10
  if (fact.freshness === 'live') score += 10
  if (fact.freshness === 'recent') score += 6
  if (fact.freshness === 'cached') score += 2
  if (fact.freshness === 'stale') score -= 20

  const ageMs = Math.max(0, now() - fact.updatedAt)
  score += Math.max(0, 5 - ageMs / (7 * 24 * 60 * 60 * 1000))

  if (query) {
    const text = normalizeSearchText(searchableFactText(fact, citationTextLookup))
    const queryTokens = searchTokens(query)
    const textTokens = new Set(searchTokens(text))
    if (text.includes(query)) {
      score += 80 + query.length
      reasons.push('query_match')
    }
    const matched = queryTokens.filter((token) => textTokens.has(token))
    if (matched.length) {
      score += matched.length * 10 + (matched.length / Math.max(queryTokens.length, 1)) * 30
      reasons.push('query_match')
    }
    if (citationMatches(fact, query, queryTokens)) {
      score += 45
      reasons.push('citation_match')
    }
  }
  const actorScore = scoreActorProfile(fact, actorProfile)
  score += actorScore.score
  reasons.push(...actorScore.reasons)
  const requirementScore = scoreEvidenceRequirements(fact, evidenceRequirements)
  score += requirementScore.score
  reasons.push(...requirementScore.reasons)

  return { fact, score, reasons: [...new Set(reasons)] }
}

function scoreEvidenceRequirements(fact: ContextFact, requirements: ContextEvidenceRequirement[]): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []
  const factFiles = new Set((fact.relatedFiles ?? []).map(normalizeComparable))
  const factSymbols = new Set((fact.relatedSymbols ?? []).map(normalizeComparable))
  const factCitationRefs = new Set(fact.citations.map((citation) => normalizeComparable(citation.ref)))

  for (const requirement of requirements) {
    if (requirement.relatedFiles.some((file) => factFiles.has(normalizeComparable(file)) || factCitationRefs.has(normalizeComparable(file)))) {
      score += requirement.priority === 'must' ? 80 : 35
      reasons.push('requirement_file_match')
    }
    if (requirement.relatedSymbols.some((symbol) => factSymbols.has(normalizeComparable(symbol)))) {
      score += requirement.priority === 'must' ? 70 : 30
      reasons.push('requirement_symbol_match')
    }
    if (requirement.docRefs.some((doc) => factCitationRefs.has(normalizeComparable(doc)))) {
      score += requirement.priority === 'must' ? 50 : 25
      reasons.push('requirement_doc_match')
    }
  }

  return { score, reasons: [...new Set(reasons)] }
}

function normalizeComparable(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase()
}

function compareRetrievedFacts(a: RetrievedContextFact, b: RetrievedContextFact): number {
  return b.score - a.score || b.fact.updatedAt - a.fact.updatedAt || b.fact.createdAt - a.fact.createdAt || a.fact.id.localeCompare(b.fact.id)
}

function citationMatches(fact: ContextFact, query: string, queryTokens: string[]): boolean {
  return fact.citations.some((citation) => {
    const ref = normalizeSearchText(citation.ref)
    return ref.includes(query) || queryTokens.some((token) => ref.includes(token))
  })
}

function searchableFactText(fact: ContextFact, citationTextLookup: Map<string, string[]> | undefined): string {
  const parts = [
    fact.id,
    fact.kind,
    fact.scope,
    fact.content,
    fact.sourceProvider,
    fact.status ?? '',
    fact.canonicalKey ?? '',
    fact.lifecycleReason ?? '',
    fact.origin?.actor ?? '',
    fact.origin?.teamId ?? '',
    fact.origin?.memberId ?? '',
    fact.origin?.taskId ?? '',
    ...(fact.tags ?? []),
    ...(fact.relatedFiles ?? []),
    ...(fact.relatedSymbols ?? []),
    ...(fact.relatedTasks ?? []),
    ...(fact.supersedes ?? []),
    ...(fact.conflictsWith ?? []),
    ...fact.citations.flatMap((citation) => [citation.id, citation.type, citation.ref, citation.hash ?? '']),
  ]
  if (citationTextLookup) {
    for (const citation of fact.citations) {
      parts.push(...(citationTextLookup.get(citation.id.toLowerCase()) ?? []))
      parts.push(...(citationTextLookup.get(citation.ref.toLowerCase()) ?? []))
      if (citation.hash) parts.push(...(citationTextLookup.get(citation.hash.toLowerCase()) ?? []))
    }
  }
  return parts.join(' ')
}

function scoreActorProfile(fact: ContextFact, profile: ActorContextProfile | undefined): { score: number; reasons: string[] } {
  if (!profile) return { score: 0, reasons: [] }

  const reasons: string[] = []
  let score = 0
  const teamMatch = Boolean(profile.teamId && fact.origin?.teamId === profile.teamId)
  const memberMatch = Boolean(profile.memberId && fact.origin?.memberId === profile.memberId)
  const taskMatch = Boolean(profile.taskId && (fact.origin?.taskId === profile.taskId || fact.relatedTasks?.includes(profile.taskId)))
  const fileMatch = matchesFileScope(fact, profile.fileScope)

  if (teamMatch) {
    score += 35
    reasons.push('actor_team_match')
  }
  if (memberMatch) {
    score += 25
    reasons.push('actor_member_match')
  }
  if (taskMatch) {
    score += 40
    reasons.push('actor_task_match')
  }
  if (fileMatch) {
    score += 55
    reasons.push('actor_file_scope_match')
  }

  switch (profile.actor) {
    case 'team_pm':
      if (teamMatch || isTeamStateFact(fact) || fact.kind === 'known_issue' || fact.kind === 'architecture_decision') {
        score += 45
        reasons.push('actor_pm_priority')
      }
      break
    case 'team_worker':
      if (taskMatch || memberMatch || fileMatch || fact.origin?.actor === 'team_worker' || isWorkerBaselineFact(fact)) {
        score += isWorkerBaselineFact(fact) ? 150 : 45
        reasons.push('actor_worker_priority')
      }
      if (fact.origin?.actor === 'team_pm' && !fileMatch) {
        score -= 120
        reasons.push('actor_worker_deprioritized_pm_state')
      }
      break
    case 'subagent':
      if (fileMatch || fact.kind === 'code_entrypoint' || fact.kind === 'module_boundary' || fact.kind === 'project_profile' || fact.kind === 'architecture_decision' || fact.kind === 'project_convention' || fact.kind === 'workflow_rule') {
        score += 35
        reasons.push('actor_subagent_project_priority')
      }
      break
    case 'main_session':
      if (fact.kind === 'project_convention' || fact.kind === 'workflow_rule' || fact.kind === 'user_preference' || fact.kind === 'architecture_decision') {
        score += 20
        reasons.push('actor_main_project_priority')
      }
      break
    case 'system':
    case 'user':
      break
  }

  return { score, reasons }
}

function suppressForActor(fact: ContextFact, profile: ActorContextProfile | undefined): string | undefined {
  if (!profile) return undefined
  if (profile.actor === 'main_session' && isRawWorkerLogFact(fact)) {
    return `Suppressed raw worker log fact ${fact.id} for main-session context pack.`
  }
  if (profile.actor === 'subagent' && isConversationOnlyGoal(fact) && !matchesFileScope(fact, profile.fileScope)) {
    return `Suppressed unrelated conversation fact ${fact.id} for subagent context pack.`
  }
  return undefined
}

function isTeamStateFact(fact: ContextFact): boolean {
  return fact.origin?.actor === 'team_pm' ||
    fact.origin?.actor === 'team_worker' ||
    includesAny(fact.tags, ['team_issue', 'team_decision', 'task_result', 'qa_issue']) ||
    fact.citations.some((citation) => citation.ref.startsWith('.team/'))
}

function isWorkerBaselineFact(fact: ContextFact): boolean {
  return fact.kind === 'project_convention' || fact.kind === 'workflow_rule'
}

function isRawWorkerLogFact(fact: ContextFact): boolean {
  return includesAny(fact.tags, ['worker_log', 'raw_worker_log']) ||
    (fact.origin?.actor === 'team_worker' && (fact.kind === 'current_goal' || fact.kind === 'runtime_error_chain') && fact.citations.some((citation) => citation.ref.includes('.team/log')))
}

function isConversationOnlyGoal(fact: ContextFact): boolean {
  return (fact.kind === 'current_goal' || fact.kind === 'runtime_error_chain') &&
    (includesAny(fact.tags, ['conversation', 'chat']) || fact.citations.some((citation) => citation.type === 'message'))
}

function includesAny(values: string[] | undefined, needles: string[]): boolean {
  if (!values?.length) return false
  const normalized = new Set(values.map((value) => value.toLowerCase()))
  return needles.some((needle) => normalized.has(needle))
}

function matchesFileScope(fact: ContextFact, fileScope: string[] | undefined): boolean {
  if (!fileScope?.length) return false
  const factRefs = [
    ...(fact.relatedFiles ?? []),
    ...fact.citations.filter((citation) => citation.type === 'file').map((citation) => citation.ref),
  ].map(normalizePathText)
  if (!factRefs.length) return false
  const scopes = fileScope.map(normalizePathText)
  return factRefs.some((ref) => scopes.some((scope) => ref === scope || ref.endsWith(`/${scope}`) || scope.endsWith(`/${ref}`)))
}

function isHighValueStaleFact(fact: ContextFact): boolean {
  return fact.kind === 'known_issue' || fact.kind === 'architecture_decision'
}

function isInactiveLifecycleFact(fact: ContextFact): boolean {
  return fact.status === 'superseded' || fact.status === 'conflicted' || fact.status === 'archived'
}

function makeDiagnostic(message: string, createdAt: number): ContextDiagnostic {
  return {
    id: `diag_context_retriever_${Math.abs(hashText(`${message}:${createdAt}`)).toString(16)}`,
    level: 'info',
    source: 'ContextRetriever',
    message,
    createdAt,
    visibleInPrimaryUi: false,
  }
}

function normalizeSearchText(text: string): string {
  return text
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizePathText(text: string): string {
  return text.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
}

function searchTokens(text: string): string[] {
  const normalized = normalizeSearchText(text)
  const tokens = new Set<string>()
  for (const token of normalized.split(' ')) {
    if (token.length >= 2) tokens.add(token)
    if (hasCjk(token)) {
      for (const segment of cjkSegments(token)) {
        for (let size = 2; size <= Math.min(4, segment.length); size += 1) {
          for (let index = 0; index + size <= segment.length; index += 1) {
            tokens.add(segment.slice(index, index + size))
          }
        }
      }
    }
  }
  return [...tokens]
}

function hasCjk(text: string): boolean {
  return /\p{Script=Han}/u.test(text)
}

function cjkSegments(text: string): string[] {
  return text.match(/\p{Script=Han}+/gu) ?? []
}

function hashText(text: string): number {
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0
  }
  return hash
}
