import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTEXT_ENGINE_CONFIG, resolveContextEngineConfig } from './config.js'

describe('Context Engine config defaults', () => {
  it('does not impose old artificial context ceilings in production defaults', () => {
    expect(DEFAULT_CONTEXT_ENGINE_CONFIG.tokenBudget.maxBundleTokens).toBeUndefined()
    expect(DEFAULT_CONTEXT_ENGINE_CONFIG.tokenBudget.maxSectionTokens).toBeUndefined()
    expect(DEFAULT_CONTEXT_ENGINE_CONFIG.tokenBudget.maxCodeTokens).toBeUndefined()
    expect(DEFAULT_CONTEXT_ENGINE_CONFIG.tokenBudget.providerOverflowPolicy).toBe('degrade_and_retry')
  })

  it('keeps explicit debug caps when the user config asks for them', () => {
    const config = resolveContextEngineConfig({
      tokenBudget: {
        maxBundleTokens: 4096,
        maxSectionTokens: 1024,
        maxCodeTokens: 2048,
      },
    })

    expect(config.tokenBudget.maxBundleTokens).toBe(4096)
    expect(config.tokenBudget.maxSectionTokens).toBe(1024)
    expect(config.tokenBudget.maxCodeTokens).toBe(2048)
  })

  it('uses realistic provider runtime defaults instead of 120ms/200ms starvation', () => {
    expect(DEFAULT_CONTEXT_ENGINE_CONFIG.performance?.providerTimeoutMs).toBeGreaterThanOrEqual(1000)
    expect(DEFAULT_CONTEXT_ENGINE_CONFIG.performance?.degradedProviderTimeoutMs).toBeGreaterThanOrEqual(1500)
  })
})
