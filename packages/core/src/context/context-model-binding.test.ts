import { describe, expect, it } from 'vitest'
import type { ModelConfig } from '../types.js'
import type { ProviderProtocol } from './types.js'
import { captureHarvestModelBinding } from './model-binding.js'

describe('harvest model binding capture', () => {
  it('captures the current session model binding for each supported provider protocol', () => {
    for (const providerProtocol of ['anthropic', 'openai-chat', 'openai-responses'] as const) {
      const modelConfig: ModelConfig = { model: `${providerProtocol}-runLoop-model`, maxTokens: 4096, contextWindow: 128_000, cacheKey: 'session_1' }
      const binding = captureHarvestModelBinding({
        sessionId: 'session_1',
        providerProtocol,
        modelId: modelConfig.model,
        modelConfig,
        modelGroupId: 'group_1',
        baseUrl: 'https://provider.local',
      })

      expect(binding).toEqual({
        sessionId: 'session_1',
        providerProtocol,
        modelId: `${providerProtocol}-runLoop-model`,
        modelConfig,
        modelGroupId: 'group_1',
        baseUrl: 'https://provider.local',
        contextWindow: 128_000,
      })
    }
  })

  it('rejects missing provider protocol or model id instead of guessing a default model', () => {
    const modelConfig: ModelConfig = { model: 'session-model', maxTokens: 1024 }

    expect(() => captureHarvestModelBinding({ sessionId: 'session_1', providerProtocol: undefined as unknown as ProviderProtocol, modelId: 'session-model', modelConfig })).toThrow('providerProtocol')
    expect(() => captureHarvestModelBinding({ sessionId: 'session_1', providerProtocol: 'anthropic', modelId: '', modelConfig })).toThrow('modelId')
  })
})
