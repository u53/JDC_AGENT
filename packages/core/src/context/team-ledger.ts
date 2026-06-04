import { createHash } from 'node:crypto'
import path from 'node:path'
import type { ContextDiagnostic, ContextFact, ContextOrigin, RawEvidence } from './types.js'
import type { ContextStore } from './store.js'
import type { TeamEvent } from '../team/team-types.js'

export interface TeamLedgerContext {
  store?: Pick<ContextStore, 'saveRawEvidence' | 'saveFact' | 'saveDiagnostic'>
  cwd: string
  sessionId?: string
  teamId: string
  now?: () => number
  id?: () => string
}

export interface TeamArtifactEvidenceInput {
  artifactId: string
  artifactKind: 'artifact' | 'contract'
  artifactType?: string
  taskId?: string
  memberId?: string
  summary: string
  path: string
}

export interface TeamIssueEvidenceInput {
  issueId: string
  title: string
  status: 'open' | 'in_progress' | 'resolved' | 'wontfix'
  severity: 'low' | 'medium' | 'high' | 'critical'
  summary: string
  taskId?: string
  memberId?: string
  path: string
}

export interface TeamTaskResultEvidenceInput {
  taskId: string
  memberId?: string
  summary: string
  path: string
}

type LedgerStore = NonNullable<TeamLedgerContext['store']>

export async function recordTeamEventEvidence(event: TeamEvent, context: TeamLedgerContext): Promise<void> {
  await runFailOpen(context, async (store) => {
    const eventPath = pathForEvent(event)
    const evidence = teamEvidence({
      id: `team_event_${safeId(context.teamId)}_${safeId(event.type)}_${hashText(JSON.stringify(event)).slice(0, 12)}`,
      content: eventContent(event),
      path: eventPath,
      context,
      capturedAt: event.timestamp,
      metadata: {
        eventType: event.type,
        event,
        path: eventPath,
        ref: eventPath,
        teamId: context.teamId,
        taskId: 'taskId' in event ? event.taskId : undefined,
        memberId: 'memberId' in event ? event.memberId : undefined,
      },
    })
    await store.saveRawEvidence(evidence)

    if (event.type !== 'manager_decision' || !isDurableManagerDecision(event.text)) return
    await store.saveFact(teamDecisionFact(event, context, evidence))
  })
}

export async function recordTeamArtifactEvidence(input: TeamArtifactEvidenceInput, context: TeamLedgerContext): Promise<void> {
  await runFailOpen(context, async (store) => {
    const evidenceId = input.artifactKind === 'contract'
      ? `team_artifact_${safeId(context.teamId)}_${safeId(input.taskId ?? 'project')}_${safeId(input.artifactId)}`
      : `team_artifact_${safeId(context.teamId)}_${safeId(input.taskId ?? 'project')}_${safeId(input.artifactId)}`
    const evidence = teamEvidence({
      id: evidenceId,
      content: `${input.artifactKind === 'contract' ? 'Contract' : 'Artifact'} ${input.artifactId}: ${input.summary}`,
      path: input.path,
      context,
      metadata: {
        eventType: input.artifactKind === 'contract' ? 'team_contract_written' : 'team_artifact_written',
        artifactId: input.artifactId,
        artifactKind: input.artifactKind,
        artifactType: input.artifactType,
        teamId: context.teamId,
        taskId: input.taskId,
        memberId: input.memberId,
        path: input.path,
        ref: input.path,
      },
    })
    await store.saveRawEvidence(evidence)
    await store.saveFact(artifactSummaryFact(input, context, evidence))
  })
}

export async function recordTeamIssueEvidence(input: TeamIssueEvidenceInput, context: TeamLedgerContext): Promise<void> {
  await runFailOpen(context, async (store) => {
    const evidence = teamEvidence({
      id: `team_issue_${safeId(context.teamId)}_${safeId(input.issueId)}`,
      content: `QA issue ${input.issueId} (${input.status}, ${input.severity}): ${input.title}\n${input.summary}`,
      path: input.path,
      context,
      metadata: {
        eventType: input.status === 'resolved' || input.status === 'wontfix' ? 'team_issue_resolved' : 'team_issue_created',
        issueId: input.issueId,
        title: input.title,
        status: input.status,
        severity: input.severity,
        teamId: context.teamId,
        taskId: input.taskId,
        memberId: input.memberId,
        path: input.path,
        ref: input.path,
      },
    })
    await store.saveRawEvidence(evidence)
    await store.saveFact(qaIssueFact(input, context, evidence))
  })
}

export async function recordTeamTaskResultEvidence(input: TeamTaskResultEvidenceInput, context: TeamLedgerContext): Promise<void> {
  await runFailOpen(context, async (store) => {
    const evidence = teamEvidence({
      id: `team_result_${safeId(context.teamId)}_${safeId(input.taskId)}`,
      content: `Task result ${input.taskId}: ${input.summary}`,
      path: input.path,
      context,
      metadata: {
        eventType: 'task_completed',
        teamId: context.teamId,
        taskId: input.taskId,
        memberId: input.memberId,
        path: input.path,
        ref: input.path,
      },
    })
    await store.saveRawEvidence(evidence)
    await store.saveFact(taskResultFact(input, context, evidence))
  })
}

async function runFailOpen(context: TeamLedgerContext, fn: (store: LedgerStore) => Promise<void>): Promise<void> {
  if (!context.store) return
  try {
    await fn(context.store)
  } catch (error) {
    await context.store.saveDiagnostic(makeDiagnostic(context, error)).catch(() => undefined)
  }
}

function teamDecisionFact(event: Extract<TeamEvent, { type: 'manager_decision' }>, context: TeamLedgerContext, evidence: RawEvidence): ContextFact {
  const now = timestamp(context, event.timestamp)
  const content = event.text.trim()
  return {
    id: `team_decision_${safeId(context.teamId)}_${hashText(content).slice(0, 12)}`,
    kind: 'team_decision',
    scope: 'project',
    content,
    citations: [citation(`cit_${evidence.id}`, evidence)],
    confidence: 0.9,
    freshness: 'recent',
    sourceProvider: 'TeamLedger',
    sessionId: context.sessionId,
    createdAt: now,
    updatedAt: now,
    origin: origin(context, 'team_pm'),
    tags: ['team', 'team_decision'],
    relatedFiles: ['.team/log.md'],
  }
}

function artifactSummaryFact(input: TeamArtifactEvidenceInput, context: TeamLedgerContext, evidence: RawEvidence): ContextFact {
  const now = timestamp(context)
  return {
    id: `artifact_summary_${safeId(context.teamId)}_${safeId(input.taskId ?? 'project')}_${safeId(input.artifactId)}`,
    kind: 'artifact_summary',
    scope: 'project',
    content: `Artifact summary: ${input.summary}`,
    citations: [citation(`cit_${evidence.id}`, evidence)],
    confidence: 0.9,
    freshness: 'recent',
    sourceProvider: 'TeamLedger',
    sessionId: context.sessionId,
    createdAt: now,
    updatedAt: now,
    origin: origin(context, 'team_worker', { memberId: input.memberId, taskId: input.taskId, artifactId: input.artifactId }),
    tags: ['team', input.artifactKind === 'contract' ? 'team_contract' : 'team_artifact'],
    relatedTasks: input.taskId ? [input.taskId] : undefined,
    relatedFiles: [input.path],
  }
}

function qaIssueFact(input: TeamIssueEvidenceInput, context: TeamLedgerContext, evidence: RawEvidence): ContextFact {
  const now = timestamp(context)
  return {
    id: `qa_issue_${safeId(context.teamId)}_${safeId(input.issueId)}`,
    kind: 'qa_issue',
    scope: 'project',
    content: `${issueStatusPrefix(input.status)} QA issue ${input.issueId}: ${input.title}. ${input.summary}`,
    citations: [citation(`cit_${evidence.id}`, evidence)],
    confidence: input.status === 'resolved' || input.status === 'wontfix' ? 0.88 : 0.92,
    freshness: input.status === 'resolved' || input.status === 'wontfix' ? 'stale' : 'recent',
    sourceProvider: 'TeamLedger',
    sessionId: context.sessionId,
    createdAt: now,
    updatedAt: now,
    origin: origin(context, 'team_worker', { memberId: input.memberId, taskId: input.taskId, artifactId: input.issueId }),
    tags: ['team', 'team_issue', `severity_${input.severity}`, `status_${input.status}`],
    relatedTasks: input.taskId ? [input.taskId] : undefined,
    relatedFiles: [input.path],
  }
}

function taskResultFact(input: TeamTaskResultEvidenceInput, context: TeamLedgerContext, evidence: RawEvidence): ContextFact {
  const now = timestamp(context)
  return {
    id: `task_result_${safeId(context.teamId)}_${safeId(input.taskId)}`,
    kind: 'task_result',
    scope: 'project',
    content: `Task result: ${input.summary}`,
    citations: [citation(`cit_${evidence.id}`, evidence)],
    confidence: 0.9,
    freshness: 'recent',
    sourceProvider: 'TeamLedger',
    sessionId: context.sessionId,
    createdAt: now,
    updatedAt: now,
    origin: origin(context, 'team_worker', { memberId: input.memberId, taskId: input.taskId }),
    tags: ['team', 'team_result'],
    relatedTasks: [input.taskId],
    relatedFiles: [input.path],
  }
}

function teamEvidence(input: {
  id: string
  content: string
  path: string
  context: TeamLedgerContext
  metadata: Record<string, unknown>
  capturedAt?: number
}): RawEvidence {
  const cwd = path.resolve(input.context.cwd)
  const content = input.content.trim()
  return {
    id: input.id,
    sessionId: input.context.sessionId ?? 'team_ledger',
    cwd,
    sourceProvider: 'TeamLedger',
    kind: 'task',
    content,
    metadata: clean({
      ...input.metadata,
      teamId: input.context.teamId,
      path: input.path,
      ref: input.path,
    }),
    capturedAt: timestamp(input.context, input.capturedAt),
    hash: hashText(content),
  }
}

function eventContent(event: TeamEvent): string {
  switch (event.type) {
    case 'team_started':
      return `Team ${event.teamId} started.`
    case 'manager_decision':
    case 'manager_reply':
    case 'member_progress':
      return event.text
    case 'member_created':
    case 'member_added':
      return `Member ${event.memberId} (${event.role}) joined the team.`
    case 'member_removed':
      return `Member ${event.memberId} (${event.role}) removed: ${event.reason ?? 'no reason provided'}.`
    case 'task_created':
      return `Task ${event.taskId} created: ${event.title}.`
    case 'task_assigned':
      return `Task ${event.taskId} assigned to ${event.memberId}.`
    case 'task_completed':
      return `Task ${event.taskId} completed by ${event.memberId}.`
    case 'task_cancelled':
      return `Task ${event.taskId} cancelled: ${event.reason}.`
    case 'task_failed':
      return `Task ${event.taskId} failed (${event.failureCount}): ${event.error}.`
    case 'tool_start':
      return `Tool ${event.toolName} started by ${event.memberId}.`
    case 'tool_complete':
      return `Tool ${event.toolName} completed by ${event.memberId}.`
    case 'tool_error':
      return `Tool ${event.toolName} failed for ${event.memberId}: ${event.reason ?? 'unknown error'}.`
    case 'finding_added':
      return `Finding ${event.findingId} added by ${event.memberId}: ${event.summary}.`
    case 'message_sent':
      return `Team message ${event.intent} sent from ${event.from} to ${event.to}.`
    case 'intervention_received':
      return `Intervention ${event.intent} received from ${event.from}.`
    case 'team_synthesizing':
      return 'Team is synthesizing final output.'
    case 'model_resolution_warning':
      return `Model resolution warning for ${event.memberId ?? 'team'}: ${event.message}`
    case 'team_completed':
      return `Team completed: ${event.summary}`
    case 'team_failed':
      return `Team failed: ${event.error}`
  }
}

function pathForEvent(event: TeamEvent): string {
  if ('taskId' in event && typeof event.taskId === 'string') return `.team/tasks/${event.taskId}/task.md`
  return '.team/log.md'
}

function isDurableManagerDecision(text: string): boolean {
  const normalized = text.trim()
  if (normalized.length < 12) return false
  if (/(思考中|等待|处理中|reviewing|waiting|thinking|in progress|status update|heartbeat)/i.test(normalized)) return false
  return /(decision|decided|must|keep|choose|chosen|adopt|决定|决策|必须|保持|采用|约定|选择)/i.test(normalized)
}

function origin(context: TeamLedgerContext, actor: ContextOrigin['actor'], extra: Partial<ContextOrigin> = {}): ContextOrigin {
  return clean({
    projectKey: path.resolve(context.cwd),
    actor,
    sessionId: context.sessionId,
    teamId: context.teamId,
    ...extra,
  }) as ContextOrigin
}

function citation(id: string, evidence: RawEvidence) {
  return {
    id,
    type: 'task' as const,
    ref: typeof evidence.metadata.path === 'string' ? evidence.metadata.path : evidence.id,
  }
}

function makeDiagnostic(context: TeamLedgerContext, error: unknown): ContextDiagnostic {
  const now = timestamp(context)
  const message = error instanceof Error ? error.message : String(error)
  return {
    id: `diag_team_ledger_${hashText(`${context.teamId}:${message}:${now}`).slice(0, 16)}`,
    level: 'warning',
    source: 'TeamLedger',
    message: `Team ledger write failed without blocking Team runtime: ${message}`,
    createdAt: now,
    visibleInPrimaryUi: false,
  }
}

function issueStatusPrefix(status: TeamIssueEvidenceInput['status']): string {
  switch (status) {
    case 'open':
      return 'Open'
    case 'in_progress':
      return 'In-progress'
    case 'resolved':
      return 'Resolved'
    case 'wontfix':
      return 'Wontfix'
  }
}

function timestamp(context: TeamLedgerContext, fallback?: number): number {
  return fallback ?? context.now?.() ?? Date.now()
}

function clean<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function safeId(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}
