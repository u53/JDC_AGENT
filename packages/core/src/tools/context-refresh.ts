import { z } from 'zod'
import type { ToolContext, ToolHandler, ToolResult } from '../tool-registry.js'
import { buildContextBundle, type ContextProvider } from '../context/orchestrator.js'
import { resolveContextEngineConfig, type ContextEngineConfigInput } from '../context/config.js'
import {
  collectCodeContext,
  collectConversationContext,
  collectGitContext,
  collectIdeContext,
  collectMemoryContext,
  collectProjectContext,
  collectRuntimeContext,
  getCodeProviderHealth,
} from '../context/providers/index.js'
import { openContextStore, type ContextStore } from '../context/store.js'
import { ContextDiagnosticSchema, ContextModeSchema, ContextProviderIdSchema } from '../context/schemas.js'
import type { ContextDiagnostic, ContextProviderId, ContextRequest, ProviderHealth } from '../context/types.js'
import { inspectableBundle, InspectableContextBundleSchema, ProviderHealthSchema, ProviderTimingSchema } from './context-inspect.js'
import { nowFromRequest, providerHealth } from '../context/providers/shared.js'

const RefreshInputSchema = z.object({
  sessionId: z.string().min(1),
  cwd: z.string().min(1).optional(),
  userMessage: z.string().optional(),
  providers: z.array(ContextProviderIdSchema).optional(),
  mode: ContextModeSchema.optional(),
  model: z.string().optional(),
  tokenBudget: z.number().int().positive().optional(),
  reindex: z.boolean().optional(),
})

export const ContextRefreshPayloadSchema = z.object({
  status: z.enum(['refreshed', 'unavailable']),
  refreshedAt: z.number(),
  requestedProviders: z.array(ContextProviderIdSchema),
  bundle: InspectableContextBundleSchema,
  providerHealth: z.array(ProviderHealthSchema),
  providerTimings: z.array(ProviderTimingSchema),
  diagnostics: z.array(ContextDiagnosticSchema),
})

export type ContextRefreshPayload = z.infer<typeof ContextRefreshPayloadSchema>
export type ContextRefreshInput = z.infer<typeof RefreshInputSchema>

type RefreshProvider = ContextProvider & { health?: (request: ContextRequest) => ProviderHealth | Promise<ProviderHealth> }

export interface RefreshContextOptions {
  store?: ContextStore
  cwd?: string
  providers?: RefreshProvider[]
  now?: () => number
  id?: () => string
  maxSectionTokens?: number
  maxCodeTokens?: number
  config?: ContextEngineConfigInput
}

export async function refreshContextProviders(input: unknown, options: RefreshContextOptions = {}): Promise<ContextRefreshPayload> {
  const now = options.now ?? Date.now
  const parsedInput = RefreshInputSchema.safeParse(input)
  const refreshedAt = now()
  if (!parsedInput.success) {
    const diagnostic = contextRefreshDiagnostic(`Context refresh rejected invalid input: ${parsedInput.error.message}`, 'warning', now())
    return ContextRefreshPayloadSchema.parse({
      status: 'unavailable',
      refreshedAt,
      requestedProviders: [],
      bundle: inspectableBundle({ id: `ctx_refresh_invalid_${refreshedAt}`, sessionId: 'unknown', requestHash: 'refresh_invalid', createdAt: refreshedAt, sections: [], citations: [], diagnostics: [diagnostic], budget: { maxTokens: 2500, usedTokens: 0, droppedTokens: 0 } }),
      providerHealth: [],
      providerTimings: [],
      diagnostics: [diagnostic],
    })
  }
  const parsed = parsedInput.data
  const store = options.store ?? await openContextStore({ cwd: parsed.cwd ?? options.cwd })
  const config = resolveContextEngineConfig(options.config)
  const configuredProviders = options.providers ?? createDefaultRefreshProviders(config)
  const requestedProviders = parsed.providers ?? providerIds(configuredProviders)
  const providers = filterProviders(configuredProviders, requestedProviders)
  const timedProviders = providers.map((provider) => withTiming(provider, now))
  const timings: z.infer<typeof ProviderTimingSchema>[] = []
  for (const provider of timedProviders) timings.push(provider.timing)

  try {
    const result = await buildContextBundle(createRefreshRequest(parsed, refreshedAt), {
      injectionEnabled: true,
      store,
      providers: timedProviders,
      now,
      id: options.id,
      maxSectionTokens: options.maxSectionTokens,
      maxCodeTokens: options.maxCodeTokens,
    })
    return ContextRefreshPayloadSchema.parse({
      status: 'refreshed',
      refreshedAt,
      requestedProviders,
      bundle: inspectableBundle(result.bundle),
      providerHealth: result.providerHealth,
      providerTimings: timings,
      diagnostics: result.bundle.diagnostics,
    })
  } catch (error) {
    const diagnostic = contextRefreshDiagnostic(error instanceof Error ? error.message : String(error), 'error', now())
    return ContextRefreshPayloadSchema.parse({
      status: 'unavailable',
      refreshedAt,
      requestedProviders,
      bundle: inspectableBundle({ id: `ctx_refresh_failed_${refreshedAt}`, sessionId: parsed.sessionId, requestHash: 'refresh_failed', createdAt: refreshedAt, sections: [], citations: [], diagnostics: [diagnostic], budget: { maxTokens: parsed.tokenBudget ?? 2500, usedTokens: 0, droppedTokens: 0 } }),
      providerHealth: [],
      providerTimings: timings,
      diagnostics: [diagnostic],
    })
  }
}

export async function getContextProviderHealth(input: unknown, options: RefreshContextOptions = {}): Promise<ProviderHealth[]> {
  const now = options.now ?? Date.now
  const parsedInput = RefreshInputSchema.safeParse(input)
  if (!parsedInput.success) return []

  const parsed = parsedInput.data
  const config = resolveContextEngineConfig(options.config)
  const configuredProviders = options.providers ?? createDefaultRefreshProviders(config)
  const requestedProviders = parsed.providers ?? providerIds(configuredProviders)
  const providers = filterProviders(configuredProviders, requestedProviders)
  const request = createRefreshRequest({ ...parsed, cwd: parsed.cwd ?? options.cwd, reindex: false }, now(), true)
  const health: ProviderHealth[] = []

  for (const provider of providers) {
    try {
      health.push(provider.health ? await provider.health(request) : providerHealth(provider.id, config.providerToggles[provider.id] ? 'enabled' : 'disabled', now()))
    } catch (error) {
      const createdAt = now()
      const diag = contextRefreshDiagnostic(error instanceof Error ? error.message : String(error), 'error', createdAt)
      health.push({ id: provider.id, status: 'failed', updatedAt: createdAt, diagnostic: diag })
    }
  }

  return z.array(ProviderHealthSchema).parse(health)
}

export function createContextRefreshTool(options: RefreshContextOptions = {}): ToolHandler {
  return {
    definition: {
      name: 'JdcContextRefresh',
      description: 'Refresh selected JDC Context Engine providers and return an inspectable bundle with provider health and timing diagnostics.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          cwd: { type: 'string' },
          userMessage: { type: 'string' },
          providers: { type: 'array', items: { type: 'string', enum: ContextProviderIdSchema.options } },
          mode: { type: 'string' },
          model: { type: 'string' },
          tokenBudget: { type: 'number' },
          reindex: { type: 'boolean' },
        },
        required: ['sessionId'],
      },
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const config = resolveContextEngineConfig(options.config)
      const providers = options.providers ?? createDefaultRefreshProviders(config)
      const payload = await refreshContextProviders({ ...input, cwd: typeof input.cwd === 'string' ? input.cwd : context.cwd } as ContextRefreshInput, { ...options, providers })
      return { content: JSON.stringify(payload, null, 2), isError: payload.status === 'unavailable' }
    },
  }
}

function contextRefreshDiagnostic(message: string, level: ContextDiagnostic['level'], createdAt: number): ContextDiagnostic {
  return { id: `diag_context_refresh_${createdAt}`, level, source: 'JdcContextRefresh', message, createdAt }
}

function createRefreshRequest(input: ContextRefreshInput, createdAt: number, healthOnly = false): ContextRequest {
  return {
    sessionId: input.sessionId,
    cwd: input.cwd ?? process.cwd(),
    userMessage: input.userMessage ?? 'Refresh JDC Context Engine providers.',
    recentMessages: [],
    mode: input.mode ?? 'debug',
    model: input.model ?? 'unknown',
    tokenBudget: input.tokenBudget ?? 2500,
    runtime: { contextRefresh: { reindex: input.reindex === true, healthOnly } },
    createdAt,
  }
}

export function createDefaultRefreshProviders(configInput: ContextEngineConfigInput = {}): RefreshProvider[] {
  const config = resolveContextEngineConfig(configInput)
  const toggles = config.providerToggles
  return [
    { id: 'conversation', collect: (request) => Promise.resolve(collectConversationContext(request, { enabled: toggles.conversation })), health: (request) => providerHealth('conversation', toggles.conversation ? 'enabled' : 'disabled', nowFromRequest(request)) },
    { id: 'runtime', collect: (request) => Promise.resolve(collectRuntimeContext(request, { enabled: toggles.runtime })), health: (request) => providerHealth('runtime', toggles.runtime ? 'enabled' : 'disabled', nowFromRequest(request)) },
    { id: 'ide', collect: (request) => Promise.resolve(collectIdeContext(request, { enabled: toggles.ide })), health: (request) => providerHealth('ide', toggles.ide ? 'enabled' : 'disabled', nowFromRequest(request)) },
    { id: 'memory', collect: (request) => collectMemoryContext(request, { enabled: toggles.memory }), health: (request) => providerHealth('memory', toggles.memory ? 'enabled' : 'disabled', nowFromRequest(request)) },
    { id: 'git', collect: (request) => collectGitContext(request, { enabled: toggles.git }), health: (request) => providerHealth('git', toggles.git ? 'enabled' : 'disabled', nowFromRequest(request)) },
    { id: 'project', collect: (request) => collectProjectContext(request, { enabled: toggles.project }), health: (request) => providerHealth('project', toggles.project ? 'enabled' : 'disabled', nowFromRequest(request)) },
    { id: 'code', collect: (request) => collectCodeContext(request, { enabled: toggles.code }), health: (request) => getCodeProviderHealth(request, { enabled: toggles.code }) },
  ]
}

function providerIds(providers: RefreshProvider[]): ContextProviderId[] {
  return providers.map((provider) => provider.id)
}

function filterProviders(providers: RefreshProvider[], requested: ContextProviderId[]): RefreshProvider[] {
  const requestedSet = new Set(requested)
  return providers.filter((provider) => requestedSet.has(provider.id))
}

function withTiming(provider: ContextProvider, now: () => number): ContextProvider & { timing: z.infer<typeof ProviderTimingSchema> } {
  const timing = { id: provider.id, startedAt: 0, completedAt: 0, durationMs: 0, status: 'pending' }
  return Object.assign({
    id: provider.id,
    async collect(request: ContextRequest) {
      timing.startedAt = now()
      try {
        const result = await provider.collect(request)
        timing.completedAt = now()
        timing.durationMs = Math.max(0, timing.completedAt - timing.startedAt)
        timing.status = result.health.status
        return result
      } catch (error) {
        timing.completedAt = now()
        timing.durationMs = Math.max(0, timing.completedAt - timing.startedAt)
        timing.status = 'failed'
        throw error
      }
    },
  }, { timing })
}
