import { describe, expect, it, vi } from 'vitest'
import {
  CONTEXT_PROMPT_SNAPSHOT_TTL_MS,
  ContextPromptSnapshotCache,
  createContextPromptSnapshotKey,
  resolveContextPromptSnapshot,
} from './prompt-snapshot-cache.js'
import type { ContextRequest } from './types.js'
import type { ContextPromptSnapshotActorProfile } from './prompt-snapshot-cache.js'

const request: ContextRequest = {
  sessionId: 'session_1',
  cwd: '/repo/project',
  userMessage: 'Fix   Cache Bug',
  recentMessages: [],
  mode: 'chat',
  model: 'claude-sonnet-4',
  runtime: {},
  createdAt: 1_000,
}

describe('ContextPromptSnapshotCache', () => {
  it('derives stable keys from normalized intent and isolates actor, project, mode, and model', () => {
    const profile: ContextPromptSnapshotActorProfile = {
      actor: 'main_session',
      sessionId: 'session_1',
    }

    const first = createContextPromptSnapshotKey({
      request,
      actorProfile: profile,
      providerProtocol: 'anthropic',
    })
    const sameIntent = createContextPromptSnapshotKey({
      request: { ...request, userMessage: ' fix cache   bug ' },
      actorProfile: profile,
      providerProtocol: 'anthropic',
    })
    const differentActor = createContextPromptSnapshotKey({
      request,
      actorProfile: { ...profile, actor: 'subagent', subSessionId: 'sub_1' },
      providerProtocol: 'anthropic',
    })
    const differentProject = createContextPromptSnapshotKey({
      request: { ...request, cwd: '/repo/other-project' },
      actorProfile: profile,
      providerProtocol: 'anthropic',
    })
    const differentMode = createContextPromptSnapshotKey({
      request: { ...request, mode: 'plan' },
      actorProfile: profile,
      providerProtocol: 'anthropic',
    })
    const differentModel = createContextPromptSnapshotKey({
      request: { ...request, model: 'gpt-5' },
      actorProfile: profile,
      providerProtocol: 'openai-responses',
    })

    expect(sameIntent).toBe(first)
    expect(differentActor).not.toBe(first)
    expect(differentProject).not.toBe(first)
    expect(differentMode).not.toBe(first)
    expect(differentModel).not.toBe(first)
  })

  it('reuses rendered prompts inside the five minute TTL and rebuilds after expiry', async () => {
    let now = 10_000
    const cache = new ContextPromptSnapshotCache({ now: () => now })
    const build = vi.fn()
      .mockResolvedValueOnce({ renderedPrompt: '<jdc-context-engine>first</jdc-context-engine>', bundleId: 'bundle_1' })
      .mockResolvedValueOnce({ renderedPrompt: '<jdc-context-engine>second</jdc-context-engine>', bundleId: 'bundle_2' })

    const first = await resolveContextPromptSnapshot({
      cache,
      request,
      actorProfile: { actor: 'main_session', sessionId: 'session_1' },
      providerProtocol: 'anthropic',
      build,
    })
    now += CONTEXT_PROMPT_SNAPSHOT_TTL_MS - 1
    const second = await resolveContextPromptSnapshot({
      cache,
      request,
      actorProfile: { actor: 'main_session', sessionId: 'session_1' },
      providerProtocol: 'anthropic',
      build,
    })
    now += 2
    const third = await resolveContextPromptSnapshot({
      cache,
      request,
      actorProfile: { actor: 'main_session', sessionId: 'session_1' },
      providerProtocol: 'anthropic',
      build,
    })

    expect(first).toMatchObject({ renderedPrompt: '<jdc-context-engine>first</jdc-context-engine>', cacheHit: false, bundleId: 'bundle_1' })
    expect(second).toMatchObject({ renderedPrompt: '<jdc-context-engine>first</jdc-context-engine>', cacheHit: true, bundleId: 'bundle_1' })
    expect(third).toMatchObject({ renderedPrompt: '<jdc-context-engine>second</jdc-context-engine>', cacheHit: false, bundleId: 'bundle_2' })
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('does not cache empty rendered prompts', async () => {
    const cache = new ContextPromptSnapshotCache({ now: () => 1_000 })
    const build = vi.fn()
      .mockResolvedValueOnce({ renderedPrompt: '', bundleId: 'empty_bundle' })
      .mockResolvedValueOnce({ renderedPrompt: '<jdc-context-engine>fresh</jdc-context-engine>', bundleId: 'fresh_bundle' })

    const first = await resolveContextPromptSnapshot({
      cache,
      request,
      actorProfile: { actor: 'main_session', sessionId: 'session_1' },
      build,
    })
    const second = await resolveContextPromptSnapshot({
      cache,
      request,
      actorProfile: { actor: 'main_session', sessionId: 'session_1' },
      build,
    })

    expect(first).toMatchObject({ renderedPrompt: '', cacheHit: false, bundleId: 'empty_bundle' })
    expect(second).toMatchObject({ renderedPrompt: '<jdc-context-engine>fresh</jdc-context-engine>', cacheHit: false, bundleId: 'fresh_bundle' })
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('bypasses a valid snapshot when forceRefresh is true', async () => {
    const cache = new ContextPromptSnapshotCache({ now: () => 1_000 })
    const build = vi.fn()
      .mockResolvedValueOnce({ renderedPrompt: '<jdc-context-engine>first</jdc-context-engine>', bundleId: 'bundle_1' })
      .mockResolvedValueOnce({ renderedPrompt: '<jdc-context-engine>forced</jdc-context-engine>', bundleId: 'bundle_2' })

    await resolveContextPromptSnapshot({
      cache,
      request,
      actorProfile: { actor: 'main_session', sessionId: 'session_1' },
      build,
    })
    const forced = await resolveContextPromptSnapshot({
      cache,
      request,
      actorProfile: { actor: 'main_session', sessionId: 'session_1' },
      forceRefresh: true,
      build,
    })

    expect(forced).toMatchObject({ renderedPrompt: '<jdc-context-engine>forced</jdc-context-engine>', cacheHit: false, bundleId: 'bundle_2' })
    expect(build).toHaveBeenCalledTimes(2)
  })
})
