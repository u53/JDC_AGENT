import { createHash } from 'node:crypto'
import path from 'node:path'
import type { ActorContextProfile, ContextRequest, ProviderProtocol } from './types.js'

export const CONTEXT_PROMPT_SNAPSHOT_TTL_MS = 5 * 60_000

// Bound the in-process cache so unique prompts cannot accumulate large rendered
// <jdc-context-engine> strings for the whole app lifetime. This is a memory
// safety guard for the cache map only; it is NOT a context capacity cap on the
// Engine bundle itself, which stays relevance-first and uncapped.
export const CONTEXT_PROMPT_SNAPSHOT_MAX_ENTRIES = 200

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
  Partial<Pick<ActorContextProfile, 'sessionId' | 'subSessionId' | 'teamId' | 'memberId' | 'taskId' | 'fileScope' | 'preferredFactCount'>>

export interface ContextPromptSnapshotKeyInput {
  request: Pick<ContextRequest, 'cwd' | 'sessionId' | 'mode' | 'model' | 'modelProfile'>
  actorProfile?: ContextPromptSnapshotActorProfile
  providerProtocol?: ProviderProtocol | 'openai' | string
}

export interface ContextPromptSnapshotCacheOptions {
  ttlMs?: number
  now?: () => number
  maxEntries?: number
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
  private readonly maxEntries: number
  private readonly entries = new Map<string, ContextPromptSnapshot>()

  constructor(options: ContextPromptSnapshotCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? CONTEXT_PROMPT_SNAPSHOT_TTL_MS
    this.now = options.now ?? Date.now
    this.maxEntries = options.maxEntries ?? CONTEXT_PROMPT_SNAPSHOT_MAX_ENTRIES
  }

  get(key: string): ContextPromptSnapshot | undefined {
    const snapshot = this.entries.get(key)
    if (!snapshot) return undefined
    if (snapshot.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    // Refresh recency so the LRU eviction order reflects real usage.
    this.entries.delete(key)
    this.entries.set(key, snapshot)
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
    this.pruneExpired(createdAt)
    this.evictOverflow()
    return snapshot
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }

  private pruneExpired(reference: number): void {
    for (const [key, snapshot] of this.entries) {
      if (snapshot.expiresAt <= reference) this.entries.delete(key)
    }
  }

  private evictOverflow(): void {
    if (this.maxEntries <= 0) return
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
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
    modelFamilyKey: modelFamilyKey(input.providerProtocol, input.request.model),
    // Strict vs standard model profiles inject different contract text, so the
    // rendered bundle differs even for the same prompt/model.
    modelProfileKey: modelProfileKey(input.request.modelProfile),
    // Retrieval scores/suppresses facts by file scope and preferred fact count,
    // so two requests in the same snapshot window with different selection knobs must
    // not share a snapshot.
    selectionKey: selectionKey(input.actorProfile),
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

function modelProfileKey(profile: ContextRequest['modelProfile']): string {
  if (!profile) return 'profile:none'
  return `profile:${profile.id}:${profile.evidenceStrictness}`
}

function selectionKey(profile: ContextPromptSnapshotActorProfile | undefined): string {
  if (!profile) return 'scope:none'
  const fileScope = profile.fileScope && profile.fileScope.length > 0
    ? [...profile.fileScope].sort().join(',')
    : 'all'
  const factCount = profile.preferredFactCount ?? 'default'
  return `scope:${fileScope}|facts:${factCount}`
}

function hashText(value: string): string {
  return createHash('sha1').update(value).digest('hex')
}
