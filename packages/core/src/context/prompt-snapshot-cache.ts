import { createHash } from 'node:crypto'
import path from 'node:path'
import type { ActorContextProfile, ContextRequest, ProviderProtocol } from './types.js'

export const CONTEXT_PROMPT_SNAPSHOT_TTL_MS = 5 * 60_000

export interface ContextPromptSnapshot {
  key: string
  renderedPrompt: string
  bundleId?: string
  createdAt: number
  expiresAt: number
  source: 'fresh'
}

export type ContextPromptSnapshotActorProfile =
  Pick<ActorContextProfile, 'actor'> &
  Partial<Pick<ActorContextProfile, 'sessionId' | 'subSessionId' | 'teamId' | 'memberId' | 'taskId'>>

export interface ContextPromptSnapshotKeyInput {
  request: Pick<ContextRequest, 'cwd' | 'sessionId' | 'mode' | 'userMessage' | 'model'>
  actorProfile?: ContextPromptSnapshotActorProfile
  providerProtocol?: ProviderProtocol | 'openai' | string
}

export interface ContextPromptSnapshotCacheOptions {
  ttlMs?: number
  now?: () => number
}

export interface ResolveContextPromptSnapshotOptions {
  cache?: ContextPromptSnapshotCache
  request: ContextRequest
  actorProfile?: ContextPromptSnapshotActorProfile
  providerProtocol?: ProviderProtocol | 'openai' | string
  forceRefresh?: boolean
  build: () => Promise<{ renderedPrompt: string; bundleId?: string }>
}

export interface ResolveContextPromptSnapshotResult {
  key: string
  renderedPrompt: string
  bundleId?: string
  cacheHit: boolean
}

export class ContextPromptSnapshotCache {
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly entries = new Map<string, ContextPromptSnapshot>()

  constructor(options: ContextPromptSnapshotCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? CONTEXT_PROMPT_SNAPSHOT_TTL_MS
    this.now = options.now ?? Date.now
  }

  get(key: string): ContextPromptSnapshot | undefined {
    const snapshot = this.entries.get(key)
    if (!snapshot) return undefined
    if (snapshot.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    return snapshot
  }

  set(key: string, renderedPrompt: string, bundleId?: string): ContextPromptSnapshot {
    const createdAt = this.now()
    const snapshot: ContextPromptSnapshot = {
      key,
      renderedPrompt,
      bundleId,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      source: 'fresh',
    }
    this.entries.set(key, snapshot)
    return snapshot
  }

  clear(): void {
    this.entries.clear()
  }
}

export const globalContextPromptSnapshotCache = new ContextPromptSnapshotCache()

export async function resolveContextPromptSnapshot(options: ResolveContextPromptSnapshotOptions): Promise<ResolveContextPromptSnapshotResult> {
  const cache = options.cache ?? globalContextPromptSnapshotCache
  const key = createContextPromptSnapshotKey({
    request: options.request,
    actorProfile: options.actorProfile,
    providerProtocol: options.providerProtocol,
  })

  if (!options.forceRefresh) {
    const snapshot = cache.get(key)
    if (snapshot) {
      return {
        key,
        renderedPrompt: snapshot.renderedPrompt,
        bundleId: snapshot.bundleId,
        cacheHit: true,
      }
    }
  }

  const fresh = await options.build()
  if (fresh.renderedPrompt) {
    cache.set(key, fresh.renderedPrompt, fresh.bundleId)
  }
  return {
    key,
    renderedPrompt: fresh.renderedPrompt,
    bundleId: fresh.bundleId,
    cacheHit: false,
  }
}

export function createContextPromptSnapshotKey(input: ContextPromptSnapshotKeyInput): string {
  const parts = {
    projectRoot: path.resolve(input.request.cwd),
    actorKey: actorKey(input.actorProfile, input.request.sessionId),
    mode: input.request.mode,
    normalizedIntentHash: hashText(normalizeIntent(input.request.userMessage)),
    modelFamilyKey: modelFamilyKey(input.providerProtocol, input.request.model),
  }
  return `ctx_prompt_snapshot_${hashText(JSON.stringify(parts)).slice(0, 24)}`
}

function actorKey(profile: ContextPromptSnapshotKeyInput['actorProfile'], sessionId: string): string {
  if (!profile) return `session:${sessionId}`
  if (profile.actor === 'main_session') return `session:${profile.sessionId ?? sessionId}`
  if (profile.actor === 'team_pm') return `team-pm:${profile.teamId ?? profile.sessionId ?? sessionId}`
  if (profile.actor === 'team_worker') {
    return [
      'team-worker',
      profile.teamId ?? 'team',
      profile.memberId ?? 'member',
      profile.taskId ?? profile.sessionId ?? sessionId,
    ].join(':')
  }
  if (profile.actor === 'subagent') return `sub:${profile.subSessionId ?? profile.sessionId ?? sessionId}`
  return `${profile.actor}:${profile.sessionId ?? sessionId}`
}

function modelFamilyKey(protocol: ContextPromptSnapshotKeyInput['providerProtocol'], model: string): string {
  const normalizedProtocol = protocol === 'openai' ? 'openai-chat' : (protocol || 'unknown')
  return `${normalizedProtocol}:${model}`
}

function normalizeIntent(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function hashText(value: string): string {
  return createHash('sha1').update(value).digest('hex')
}
