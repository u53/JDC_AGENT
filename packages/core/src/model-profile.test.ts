import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODEL_CAPABILITY_PROFILE_ID,
  type ModelCapabilityProfile,
  resolveModelCapabilityProfile,
  strictToolGroundingProfile,
} from './model-profile.js'

// Helper to build a minimal valid profile with sensible defaults.
function makeProfile(overrides: Partial<ModelCapabilityProfile> & { id: string }): ModelCapabilityProfile {
  return {
    label: overrides.id,
    match: { providerPattern: '*', modelPattern: '*' },
    reasoningReliability: 'high',
    toolDiscipline: 'high',
    contextUseDiscipline: 'high',
    evidenceStrictness: 'standard',
    contractVerbosity: 'normal',
    requiresCompactActionContracts: false,
    defaultPlanDepth: 'normal',
    maxParallelToolCalls: 3,
    requireStepwiseVerification: false,
    ...overrides,
  }
}

describe('resolveModelCapabilityProfile', () => {
  it('returns the standard default profile for unknown models', () => {
    const profile = resolveModelCapabilityProfile({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-6',
    })

    expect(profile).toMatchObject({
      id: DEFAULT_MODEL_CAPABILITY_PROFILE_ID,
      evidenceStrictness: 'standard',
      contractVerbosity: 'normal',
      maxParallelToolCalls: 5,
    })
  })

  it('matches strict profiles by provider and model glob', () => {
    const profile = resolveModelCapabilityProfile({
      providerId: 'ollama',
      modelId: 'glm-4.5',
      profiles: [
        strictToolGroundingProfile({
          id: 'strict_local_glm',
          providerPattern: 'ollama',
          modelPattern: 'glm*',
        }),
      ],
    })

    expect(profile).toMatchObject({
      id: 'strict_local_glm',
      evidenceStrictness: 'strict',
      requiresCompactActionContracts: true,
      defaultPlanDepth: 'detailed',
      maxParallelToolCalls: 2,
    })
  })

  it('uses explicit override before pattern matching', () => {
    // The competing profile matches by pattern order (appears first) and
    // would win if override were not applied.
    const competingProfile = strictToolGroundingProfile({
      id: 'competing_first_match',
      providerPattern: '*',
      modelPattern: 'claude*',
    })

    const profile = resolveModelCapabilityProfile({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      overrideProfileId: 'strict_override',
      profiles: [
        competingProfile,
        strictToolGroundingProfile({
          id: 'strict_override',
          providerPattern: 'ollama',
          modelPattern: 'glm*',
        }),
      ],
    })

    expect(profile.id).toBe('strict_override')
    expect(profile.evidenceStrictness).toBe('strict')
  })

  it('strictToolGroundingProfile defaults label when absent', () => {
    const profile = strictToolGroundingProfile({
      id: 'test',
      providerPattern: '*',
      modelPattern: '*',
    })

    expect(profile.label).toBe('Strict tool grounding')
  })

  it('strictToolGroundingProfile preserves explicit label', () => {
    const profile = strictToolGroundingProfile({
      id: 'test',
      providerPattern: '*',
      modelPattern: '*',
      label: 'Custom label',
    })

    expect(profile.label).toBe('Custom label')
  })

  it('sanitizeProfiles filters profiles lacking id, providerPattern, or modelPattern', () => {
    const profile = resolveModelCapabilityProfile({
      providerId: 'test',
      modelId: 'test-model',
      profiles: [
        makeProfile({ id: '', match: { providerPattern: '*', modelPattern: '*' }, label: 'empty id' }),
        makeProfile({ id: 'no_model_pat', match: { providerPattern: '*', modelPattern: '' }, label: 'empty model pattern' }),
        makeProfile({ id: 'no_provider_pat', match: { providerPattern: '', modelPattern: 'test*' }, label: 'empty provider pattern' }),
        makeProfile({ id: 'valid', match: { providerPattern: '*', modelPattern: 'test*' }, label: 'valid' }),
      ],
    })

    // Invalid profiles are filtered; only the valid one matches
    expect(profile.id).toBe('valid')
    expect(profile.maxParallelToolCalls).toBe(3)
  })

  it('falls back to default when override id is absent', () => {
    const profile = resolveModelCapabilityProfile({
      providerId: 'custom',
      modelId: 'unknown-model',
      overrideProfileId: 'missing_profile',
      profiles: [],
    })

    expect(profile.id).toBe(DEFAULT_MODEL_CAPABILITY_PROFILE_ID)
  })

  it('falls back to DEFAULT_MODEL_CAPABILITY_PROFILES[0] when custom profiles lack standard_default', () => {
    const customOnly = strictToolGroundingProfile({
      id: 'custom_only',
      providerPattern: 'acme',
      modelPattern: 'widget*',
    })

    // Model doesn't match any custom profile; custom profiles have no standard_default
    const profile = resolveModelCapabilityProfile({
      providerId: 'other',
      modelId: 'unknown',
      profiles: [customOnly],
    })

    // Must fall back to DEFAULT_MODEL_CAPABILITY_PROFILES[0], not customOnly
    expect(profile.id).toBe(DEFAULT_MODEL_CAPABILITY_PROFILE_ID)
  })

  it('clamps maxParallelToolCalls > 5 down to 5', () => {
    const profile = resolveModelCapabilityProfile({
      providerId: 'p',
      modelId: 'm',
      profiles: [makeProfile({ id: 'high', maxParallelToolCalls: 99 })],
    })
    expect(profile.maxParallelToolCalls).toBe(5)
  })

  it('clamps maxParallelToolCalls < 1 up to 1', () => {
    const profile = resolveModelCapabilityProfile({
      providerId: 'p',
      modelId: 'm',
      profiles: [makeProfile({ id: 'low', maxParallelToolCalls: -3 })],
    })
    expect(profile.maxParallelToolCalls).toBe(1)
  })

  it('clamps non-finite maxParallelToolCalls to 1', () => {
    const profile = resolveModelCapabilityProfile({
      providerId: 'p',
      modelId: 'm',
      profiles: [makeProfile({ id: 'nan', maxParallelToolCalls: Number.NaN })],
    })
    expect(profile.maxParallelToolCalls).toBe(1)
  })

  it('rounds non-integer maxParallelToolCalls to nearest integer within 1..5', () => {
    const profile = resolveModelCapabilityProfile({
      providerId: 'p',
      modelId: 'm',
      profiles: [makeProfile({ id: 'float', maxParallelToolCalls: 3.7 })],
    })
    expect(profile.maxParallelToolCalls).toBe(4)
  })

  it('matches provider and model patterns case-insensitively', () => {
    const profile = resolveModelCapabilityProfile({
      providerId: 'Anthropic',
      modelId: 'Claude-Sonnet-4-6',
      profiles: [
        makeProfile({
          id: 'case_insensitive',
          match: { providerPattern: 'anthropic', modelPattern: 'claude-sonnet*' },
        }),
      ],
    })
    expect(profile.id).toBe('case_insensitive')
  })

  it('treats ? as a literal character in glob patterns, not a single-char wildcard', () => {
    const profile = strictToolGroundingProfile({
      id: 'question_mark',
      providerPattern: '*',
      modelPattern: 'model?variant',
    })

    // Exact literal match: the "?" is part of the model name
    const matched = resolveModelCapabilityProfile({
      providerId: 'any',
      modelId: 'model?variant',
      profiles: [profile],
    })
    expect(matched.id).toBe('question_mark')

    // Should NOT match when ? is replaced by a different character
    const notMatched = resolveModelCapabilityProfile({
      providerId: 'any',
      modelId: 'modelXvariant',
      profiles: [profile],
    })
    expect(notMatched.id).not.toBe('question_mark')
  })
})
