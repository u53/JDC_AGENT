import path from 'node:path'
import type { ActorContextProfile, ContextMode, ContextRequest } from './types.js'

export interface SubAgentProfileOptions {
  sessionId: string
  cwd: string
  mode: ContextMode
  objective: string
  subSessionId?: string
  parentObjective?: string
  fileScope?: string[]
  preferredFactCount?: number
  explicitTokenCap?: number
  explicitCodeTokenCap?: number
}

export interface TeamPmProfileOptions {
  sessionId: string
  cwd: string
  mode: ContextMode
  objective: string
  teamId?: string
  preferredFactCount?: number
  explicitTokenCap?: number
  explicitCodeTokenCap?: number
}

export interface TeamWorkerProfileOptions {
  sessionId: string
  cwd: string
  mode: ContextMode
  objective: string
  teamId?: string
  memberId?: string
  taskId?: string
  fileScope?: string[]
  preferredFactCount?: number
  explicitTokenCap?: number
  explicitCodeTokenCap?: number
}

export function mainSessionProfile(request: ContextRequest, objective = request.userMessage): ActorContextProfile {
  return compactProfile({
    actor: 'main_session',
    sessionId: request.sessionId,
    cwd: normalizeCwd(request.cwd),
    mode: request.mode,
    objective: normalizeObjective(objective || request.userMessage),
    includeTeamState: false,
    includeWorkerLogs: false,
  })
}

export function subAgentProfile(opts: SubAgentProfileOptions): ActorContextProfile {
  const objective = [opts.parentObjective, opts.objective].filter(Boolean).join('\n')
  return compactProfile({
    actor: 'subagent',
    sessionId: opts.sessionId,
    cwd: normalizeCwd(opts.cwd),
    mode: opts.mode,
    objective: normalizeObjective(objective),
    subSessionId: opts.subSessionId,
    fileScope: normalizeFileScope(opts.cwd, opts.fileScope),
    preferredFactCount: opts.preferredFactCount,
    explicitTokenCap: opts.explicitTokenCap,
    explicitCodeTokenCap: opts.explicitCodeTokenCap,
    includeTeamState: false,
    includeWorkerLogs: false,
  })
}

export function teamPmProfile(opts: TeamPmProfileOptions): ActorContextProfile {
  return compactProfile({
    actor: 'team_pm',
    sessionId: opts.sessionId,
    cwd: normalizeCwd(opts.cwd),
    mode: opts.mode,
    objective: normalizeObjective(opts.objective),
    teamId: opts.teamId,
    preferredFactCount: opts.preferredFactCount,
    explicitTokenCap: opts.explicitTokenCap,
    explicitCodeTokenCap: opts.explicitCodeTokenCap,
    includeTeamState: true,
    includeWorkerLogs: false,
  })
}

export function teamWorkerProfile(opts: TeamWorkerProfileOptions): ActorContextProfile {
  return compactProfile({
    actor: 'team_worker',
    sessionId: opts.sessionId,
    cwd: normalizeCwd(opts.cwd),
    mode: opts.mode,
    objective: normalizeObjective(opts.objective),
    teamId: opts.teamId,
    memberId: opts.memberId,
    taskId: opts.taskId,
    fileScope: normalizeFileScope(opts.cwd, opts.fileScope),
    preferredFactCount: opts.preferredFactCount,
    explicitTokenCap: opts.explicitTokenCap,
    explicitCodeTokenCap: opts.explicitCodeTokenCap,
    includeTeamState: true,
    includeWorkerLogs: false,
  })
}

function normalizeCwd(cwd: string): string {
  return path.resolve(cwd)
}

function normalizeObjective(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeFileScope(cwd: string, fileScope: string[] | undefined): string[] | undefined {
  if (!fileScope?.length) return undefined
  const root = normalizeCwd(cwd)
  const normalized = new Set<string>()
  for (const item of fileScope) {
    const clean = item.trim()
    if (!clean) continue
    const relative = path.isAbsolute(clean) ? path.relative(root, clean) : clean
    const stable = relative.split(path.sep).join('/')
    if (!stable || stable.startsWith('..')) {
      normalized.add(clean.split(path.sep).join('/'))
    } else {
      normalized.add(stable)
    }
  }
  return normalized.size ? [...normalized] : undefined
}

function compactProfile(profile: ActorContextProfile): ActorContextProfile {
  return Object.fromEntries(Object.entries(profile).filter(([, value]) => {
    if (value === undefined) return false
    if (Array.isArray(value) && value.length === 0) return false
    return true
  })) as ActorContextProfile
}
