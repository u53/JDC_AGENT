import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTEXT_ENGINE_CONFIG } from './config.js'
import { ContextProviderIdSchema } from './schemas.js'

describe('WorkflowSignalProvider', () => {
  it('registers workflow as a first-class context provider id', () => {
    expect(ContextProviderIdSchema.safeParse('workflow').success).toBe(true)
    expect(DEFAULT_CONTEXT_ENGINE_CONFIG.providerToggles.workflow).toBe(true)
  })
})
