// ---------------------------------------------------------------------------
// Model Capability Profile
//
// Deterministic profile resolution from provider id, model id, optional
// explicit override, and optional user-configured profiles.
// ---------------------------------------------------------------------------

export type ModelProfileReliability = 'low' | 'medium' | 'high'
export type ModelEvidenceStrictness = 'strict' | 'standard' | 'relaxed'
export type ModelContractVerbosity = 'compact' | 'normal' | 'explicit'
export type ModelPlanDepth = 'brief' | 'normal' | 'detailed'

export interface ModelProfileMatch {
  providerPattern: string
  modelPattern: string
}

export interface ModelCapabilityProfile {
  id: string
  label: string
  match: ModelProfileMatch
  reasoningReliability: ModelProfileReliability
  toolDiscipline: ModelProfileReliability
  contextUseDiscipline: ModelProfileReliability
  evidenceStrictness: ModelEvidenceStrictness
  contractVerbosity: ModelContractVerbosity
  requiresCompactActionContracts: boolean
  defaultPlanDepth: ModelPlanDepth
  maxParallelToolCalls: number
  requireStepwiseVerification: boolean
}

export interface ResolveModelCapabilityProfileInput {
  providerId?: string
  modelId: string
  overrideProfileId?: string
  profiles?: ModelCapabilityProfile[]
}

export const DEFAULT_MODEL_CAPABILITY_PROFILE_ID = 'standard_default'

export const DEFAULT_MODEL_CAPABILITY_PROFILES: ModelCapabilityProfile[] = [
  {
    id: DEFAULT_MODEL_CAPABILITY_PROFILE_ID,
    label: 'Standard Default',
    match: { providerPattern: '*', modelPattern: '*' },
    reasoningReliability: 'high',
    toolDiscipline: 'high',
    contextUseDiscipline: 'high',
    evidenceStrictness: 'standard',
    contractVerbosity: 'normal',
    requiresCompactActionContracts: false,
    defaultPlanDepth: 'normal',
    maxParallelToolCalls: 5,
    requireStepwiseVerification: false,
  },
]

export function strictToolGroundingProfile(input: {
  id: string
  providerPattern: string
  modelPattern: string
  label?: string
}): ModelCapabilityProfile {
  return {
    id: input.id,
    label: input.label ?? 'Strict tool grounding',
    match: {
      providerPattern: input.providerPattern,
      modelPattern: input.modelPattern,
    },
    reasoningReliability: 'medium',
    toolDiscipline: 'medium',
    contextUseDiscipline: 'medium',
    evidenceStrictness: 'strict',
    contractVerbosity: 'explicit',
    requiresCompactActionContracts: true,
    defaultPlanDepth: 'detailed',
    maxParallelToolCalls: 2,
    requireStepwiseVerification: true,
  }
}

export function resolveModelCapabilityProfile(
  input: ResolveModelCapabilityProfileInput,
): ModelCapabilityProfile {
  const sanitized = sanitizeProfiles(input.profiles)
  const profiles = sanitized.length > 0 ? sanitized : DEFAULT_MODEL_CAPABILITY_PROFILES

  const fallback =
    profiles.find((p) => p.id === DEFAULT_MODEL_CAPABILITY_PROFILE_ID) ??
    DEFAULT_MODEL_CAPABILITY_PROFILES[0]

  // Explicit override wins over pattern matching
  if (input.overrideProfileId) {
    const overridden = profiles.find((p) => p.id === input.overrideProfileId)
    if (overridden) return overridden
  }

  // Pattern match against provider and model
  const providerId = input.providerId ?? ''
  const modelId = input.modelId

  for (const profile of profiles) {
    if (
      simpleGlobMatch(profile.match.providerPattern, providerId) &&
      simpleGlobMatch(profile.match.modelPattern, modelId)
    ) {
      return profile
    }
  }

  return fallback
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sanitizeProfiles(
  profiles: ModelCapabilityProfile[] | undefined,
): ModelCapabilityProfile[] {
  if (!profiles || profiles.length === 0) return []
  return profiles
    .filter((p) => p.id && p.match?.providerPattern && p.match?.modelPattern)
    .map((p) => ({
      ...p,
      maxParallelToolCalls: clampMaxParallelToolCalls(p.maxParallelToolCalls),
    }))
}

function clampMaxParallelToolCalls(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(5, Math.max(1, Math.round(value)))
}

/**
 * Case-insensitive simple glob matching.
 * Only `*` is treated as a wildcard (matches zero or more characters).
 * All comparisons are lowercased.
 */
function simpleGlobMatch(pattern: string, value: string): boolean {
  const lowerPattern = pattern.toLowerCase()
  const lowerValue = value.toLowerCase()

  // Exact match or bare wildcard
  if (lowerPattern === '*' || lowerPattern === lowerValue) return true

  // Convert simple `*` glob to regex
  // Escape all regex metacharacters except `*` (the only glob wildcard)
  const escaped = lowerPattern.replace(/[.+^${}()|[\]\\?]/g, '\\$&')
  const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$')
  return regex.test(lowerValue)
}
