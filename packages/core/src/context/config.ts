import type { ContextEngineConfig, ContextProviderId } from './types.js'

export const DEFAULT_CONTEXT_ENGINE_CONFIG: ContextEngineConfig = {
  enabled: true,
  injectionEnabled: true,
  harvestEnabled: true,
  inspectEnabled: true,
  providerToggles: {
    code: true,
    project: true,
    workflow: true,
    git: true,
    conversation: true,
    memory: true,
    runtime: true,
    ide: true,
  },
  // Product contract: production JDC Context Engine must not carry hidden
  // local token/section/code ceilings. Keep this object cap-free unless a
  // caller explicitly opts into a debug override.
  tokenBudget: {
    providerOverflowPolicy: 'degrade_and_retry',
  },
  harvest: {
    maxJobsPerSession: 50,
    maxOutputTokens: 1200,
    timeoutMs: 30_000,
    minIntervalMs: 15_000,
  },
  performance: {
    providerTimeoutMs: 1_200,
    degradedProviderTimeoutMs: 1_800,
    maxBackgroundJobsPerProject: 1,
    harvestMinIntervalMs: 30_000,
    contextPanelMaxRows: 50,
  },
  retention: {
    bundleSnapshots: 50,
    rejectedCandidates: 100,
    rawEvidenceTtlMs: 7 * 24 * 60 * 60 * 1000,
  },
  memory: {
    trustMode: 'auto_accept_high_confidence',
    minConfidence: 0.86,
  },
  redaction: {
    enabled: true,
    mode: 'strict',
  },
}

export type ContextEngineConfigInput = Partial<Omit<ContextEngineConfig, 'providerToggles' | 'tokenBudget' | 'harvest' | 'performance' | 'retention' | 'memory' | 'redaction'>> & {
  providerToggles?: Partial<Record<ContextProviderId, boolean>>
  tokenBudget?: Partial<ContextEngineConfig['tokenBudget']>
  harvest?: Partial<ContextEngineConfig['harvest']>
  performance?: Partial<NonNullable<ContextEngineConfig['performance']>>
  retention?: Partial<ContextEngineConfig['retention']>
  memory?: Partial<ContextEngineConfig['memory']>
  redaction?: Partial<ContextEngineConfig['redaction']>
}

export function resolveContextEngineConfig(input: ContextEngineConfigInput = {}): ContextEngineConfig {
  return {
    ...DEFAULT_CONTEXT_ENGINE_CONFIG,
    ...input,
    providerToggles: { ...DEFAULT_CONTEXT_ENGINE_CONFIG.providerToggles, ...input.providerToggles },
    tokenBudget: { ...DEFAULT_CONTEXT_ENGINE_CONFIG.tokenBudget, ...input.tokenBudget },
    harvest: { ...DEFAULT_CONTEXT_ENGINE_CONFIG.harvest, ...input.harvest },
    performance: { ...DEFAULT_CONTEXT_ENGINE_CONFIG.performance!, ...input.performance },
    retention: { ...DEFAULT_CONTEXT_ENGINE_CONFIG.retention, ...input.retention },
    memory: { ...DEFAULT_CONTEXT_ENGINE_CONFIG.memory, ...input.memory },
    redaction: { ...DEFAULT_CONTEXT_ENGINE_CONFIG.redaction, ...input.redaction },
  }
}
