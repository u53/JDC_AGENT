export type TeamStatus = 'planning' | 'running' | 'waiting' | 'synthesizing' | 'completed' | 'failed' | 'stopped'
export type MemberStatus = 'queued' | 'running' | 'waiting' | 'blocked' | 'completed' | 'failed' | 'stopped'
export type TaskStatus = 'todo' | 'assigned' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled' | 'reopened'
export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'wontfix'
export type IssueSeverity = 'low' | 'medium' | 'high' | 'critical'
export type Priority = 'low' | 'normal' | 'high' | 'urgent'
export type RiskLevel = 'low' | 'medium' | 'high'
export type Confidence = 'low' | 'medium' | 'high'
export type TeamCapability = 'read' | 'write' | 'shell' | 'web' | 'lsp'

export type TeamMessageIntent =
  | 'message' | 'hurry' | 'wrap_up' | 'request_status'
  | 'reprioritize' | 'narrow_scope' | 'expand_scope'
  | 'block' | 'unblock' | 'question' | 'answer' | 'finding' | 'handoff'
  | 'assign' | 'schedule'

export interface TeamMemberSpec {
  role: string
  /**
   * One-sentence statement of what THIS specific member is responsible for and how
   * they differ from peers. Injected into the worker's system prompt so behavior
   * actually diverges, and shown in the UI so the user can tell members apart.
   */
  responsibility?: string
  agentType?: string
  modelId?: string
  /**
   * Domain-specific expert identity prompt injected into the worker's task prompt.
   * Can be a preset key (backend, frontend, frontend-ui, qa, devops, database, security, architect)
   * or custom text describing expertise and work patterns.
   */
  expertPrompt?: string
}

export interface TeamMessage {
  id: string
  from: 'user' | 'main_session' | 'manager' | 'member' | 'system'
  fromMemberId?: string
  to: 'team' | 'manager' | string // 'member:xxx'
  intent: TeamMessageIntent
  content: string
  priority: Priority
  createdAt: number
  deliveredAt?: number
  readAt?: number
}

export interface TeamFinding {
  id: string
  memberId: string
  taskId?: string
  summary: string
  details?: string
  evidence?: Array<{ file?: string; line?: number; symbol?: string; note: string }>
  confidence: Confidence
  createdAt: number
}

export interface TeamDecision {
  id: string
  summary: string
  madeBy: 'manager' | 'user'
  reason: string
  createdAt: number
}

export interface TeamArtifact {
  id: string
  type: 'file' | 'plan' | 'report' | 'diff' | 'other'
  path?: string
  content?: string
  createdBy: string
  createdAt: number
}

export interface TeamQuestion {
  id: string
  askedBy: string
  question: string
  answeredBy?: string
  answer?: string
  status: 'open' | 'answered'
  createdAt: number
}

export interface TeamRisk {
  id: string
  description: string
  severity: RiskLevel
  identifiedBy: string
  mitigation?: string
  createdAt: number
}

export interface TeamTaskResult {
  summary: string
  findings: TeamFinding[]
  artifacts?: TeamArtifact[]
  blockers?: string[]
  suggestedFollowUps?: string[]
}

export interface TeamTask {
  id: string
  title: string
  description: string
  status: TaskStatus
  assigneeId?: string
  dependsOn?: string[]
  priority: Priority
  riskLevel: RiskLevel
  createdBy: 'manager' | 'user' | 'main_session' | 'system'
  createdAt: number
  updatedAt: number
  result?: TeamTaskResult
  lastError?: string
  failureCount?: number
}

export interface TeamSharedContext {
  objective: string
  constraints: string[]
  findings: TeamFinding[]
  decisions: TeamDecision[]
  artifacts: TeamArtifact[]
  openQuestions: TeamQuestion[]
  risks: TeamRisk[]
}

export interface TeamManagerState {
  id: string
  role: 'project-manager'
  name: string
  status: 'planning' | 'assigning' | 'waiting_for_members' | 'reviewing_results' | 'handling_intervention' | 'synthesizing' | 'completed' | 'failed'
  modelId?: string
  currentDecision?: string
  lastActivityAt: number
}

export interface TeamMemberState {
  id: string
  name: string
  role: string
  responsibility?: string
  expertPrompt?: string
  agentType: string
  modelId?: string
  status: MemberStatus
  capabilities: TeamCapability[]
  currentTaskId?: string
  lastActivityAt: number
  toolCount: number
  result?: TeamTaskResult
}

export type TeamEvent =
  | { type: 'team_started'; teamId: string; timestamp: number }
  | { type: 'manager_decision'; text: string; timestamp: number }
  | { type: 'manager_reply'; text: string; timestamp: number }
  | { type: 'member_created'; memberId: string; role: string; timestamp: number }
  | { type: 'member_added'; memberId: string; role: string; agentType: string; reason?: string; timestamp: number }
  | { type: 'member_removed'; memberId: string; role: string; reason?: string; timestamp: number }
  | { type: 'task_created'; taskId: string; title: string; timestamp: number }
  | { type: 'task_assigned'; taskId: string; memberId: string; timestamp: number }
  | { type: 'task_completed'; taskId: string; memberId: string; timestamp: number }
  | { type: 'task_cancelled'; taskId: string; reason: string; timestamp: number }
  | { type: 'task_failed'; taskId: string; error: string; failureCount: number; timestamp: number }
  | { type: 'member_progress'; memberId: string; text: string; timestamp: number }
  | { type: 'tool_start'; memberId: string; toolName: string; timestamp: number }
  | { type: 'tool_complete'; memberId: string; toolName: string; timestamp: number }
  | { type: 'tool_error'; memberId: string; toolName: string; reason?: string; timestamp: number }
  | { type: 'finding_added'; memberId: string; findingId: string; summary: string; timestamp: number }
  | { type: 'message_sent'; from: string; to: string; intent: string; timestamp: number }
  | { type: 'intervention_received'; from: 'user' | 'main_session' | 'member'; intent: string; fromMemberId?: string; timestamp: number }
  | { type: 'team_synthesizing'; timestamp: number }
  | { type: 'team_completed'; summary: string; timestamp: number }
  | { type: 'team_failed'; error: string; timestamp: number }

export interface TeamConcurrencyPolicy {
  maxWorkersPerTeam: number
  maxActiveWorkers: number
  maxReadOnlyWorkers: number
  maxWriteWorkers: number
  maxShellWorkers: number
}

export const DEFAULT_CONCURRENCY_POLICY: TeamConcurrencyPolicy = {
  maxWorkersPerTeam: 10,
  maxActiveWorkers: 8,
  maxReadOnlyWorkers: 8,
  maxWriteWorkers: 5,
  maxShellWorkers: 2,
}

// ── Workspace frontmatter types ─────────────────────────────────────────

export interface TaskFrontmatter {
  id: string
  title: string
  status: TaskStatus
  assignee?: string
  depends_on?: string[]
  contracts?: string[]            // Phase 2 — populated only by Phase 2 code
  issues_open?: string[]          // Phase 3 — populated only by Phase 3 code
  created_at: string              // ISO 8601
  updated_at: string
}

export interface ResultFrontmatter {
  task_id: string
  completed_by: string
  completed_at: string
  summary: string
  artifacts: string[]
  contracts_produced?: string[]   // Phase 2
}

export interface ArtifactFrontmatter {
  id: string
  type: 'report' | 'code' | 'design' | 'decision' | 'data'
  created_by: string              // memberId
  on_task: string                 // taskId
  summary: string                 // REQUIRED — must be one sentence
  related_contracts?: string[]    // Phase 2
  created_at: string
}

export interface ArtifactSummary {
  id: string
  taskId: string
  type: string
  summary: string
  filePath: string                // relative to workspace root, e.g. tasks/T001/artifacts/M001-x.md
}

export interface ContractFrontmatter {
  name: string
  version: number
  locked_by_task: string
  related_tasks?: string[]
  created_at: string
  updated_at: string
}

export interface ContractSummary {
  name: string
  version: number
  filePath: string                // tasks-relative path: contracts/<name>.md
}

export interface IssueFrontmatter {
  id: string
  title: string
  status: IssueStatus
  severity: IssueSeverity
  opened_by: string               // memberId
  on_task: string                 // taskId where the issue was discovered
  related_contract?: string
  assigned_to?: string | null
  opened_at: string
  resolved_at?: string | null
}
