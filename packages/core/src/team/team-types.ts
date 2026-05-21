export type TeamStatus = 'planning' | 'running' | 'waiting' | 'synthesizing' | 'completed' | 'failed' | 'stopped'
export type MemberStatus = 'queued' | 'running' | 'waiting' | 'blocked' | 'completed' | 'failed' | 'stopped'
export type TaskStatus = 'todo' | 'assigned' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled'
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
  count?: number
  agentType?: string
  modelId?: string
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
  | { type: 'member_progress'; memberId: string; text: string; timestamp: number }
  | { type: 'tool_start'; memberId: string; toolName: string; timestamp: number }
  | { type: 'tool_complete'; memberId: string; toolName: string; timestamp: number }
  | { type: 'finding_added'; memberId: string; findingId: string; summary: string; timestamp: number }
  | { type: 'message_sent'; from: string; to: string; intent: string; timestamp: number }
  | { type: 'intervention_received'; from: 'user' | 'main_session'; intent: string; timestamp: number }
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
  maxWriteWorkers: 3,
  maxShellWorkers: 3,
}
