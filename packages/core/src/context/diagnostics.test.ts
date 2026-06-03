import { describe, expect, it } from 'vitest'
import { createContextDiagnostics } from './diagnostics.js'
import type { ContextDiagnostic } from './types.js'

describe('JDC Context diagnostics', () => {
  it('records accepted, skipped, rejected, and failed harvest diagnostics without durable raw reasoning content', () => {
    const diagnostics = createContextDiagnostics({ now: () => 42 })

    diagnostics.recordHarvestAccepted({ jobId: 'job_accepted', factIds: ['fact_1'], source: 'HarvestPipeline' })
    diagnostics.recordHarvestSkipped({ jobId: 'job_skipped', reason: 'greeting_or_smalltalk', source: 'HarvestClassifier' })
    diagnostics.recordHarvestRejected({ jobId: 'job_rejected', reason: 'missing citation', source: 'DistillerValidator', validationErrors: ['citation required'] })
    diagnostics.recordHarvestFailed({ jobId: 'job_failed', error: new Error('provider timeout'), source: 'RuntimeNarrativeDistiller' })
    diagnostics.recordHarvestRejected({ jobId: 'job_reasoning', reason: 'raw reasoning is not allowed', source: 'DistillerValidator', candidate: { rawThinking: 'secret chain of thought' } })

    const messages = diagnostics.listDiagnostics().map((diagnostic: ContextDiagnostic) => diagnostic.message)
    expect(messages).toContain('Harvest job job_accepted accepted 1 context fact(s).')
    expect(messages).toContain('Harvest job job_skipped skipped: greeting_or_smalltalk.')
    expect(messages).toContain('Harvest job job_rejected rejected: missing citation. Validation: citation required.')
    expect(messages).toContain('Harvest job job_failed failed: provider timeout.')
    expect(messages.join('\n')).not.toContain('secret chain of thought')
    expect(diagnostics.listDiagnostics().every((diagnostic) => diagnostic.createdAt === 42)).toBe(true)
  })

  it('tracks provider health states and emits diagnostics for stale, failed, and rate-limited providers', () => {
    const diagnostics = createContextDiagnostics({ now: () => 1_000 })

    diagnostics.updateProviderHealth({ id: 'code', status: 'enabled' })
    diagnostics.updateProviderHealth({ id: 'memory', status: 'stale', message: 'Memory records older than TTL.' })
    diagnostics.updateProviderHealth({ id: 'git', status: 'failed', message: 'git status timed out' })
    diagnostics.updateProviderHealth({ id: 'runtime', status: 'rate_limited', message: 'Runtime event quota exceeded' })

    expect(diagnostics.listProviderHealth()).toEqual([
      { id: 'code', status: 'enabled', updatedAt: 1_000 },
      {
        id: 'memory',
        status: 'stale',
        updatedAt: 1_000,
        diagnostic: expect.objectContaining({ level: 'warning', source: 'ProviderHealth:memory', message: 'Memory records older than TTL.' }),
      },
      {
        id: 'git',
        status: 'failed',
        updatedAt: 1_000,
        diagnostic: expect.objectContaining({ level: 'error', source: 'ProviderHealth:git', message: 'git status timed out' }),
      },
      {
        id: 'runtime',
        status: 'rate_limited',
        updatedAt: 1_000,
        diagnostic: expect.objectContaining({ level: 'warning', source: 'ProviderHealth:runtime', message: 'Runtime event quota exceeded' }),
      },
    ])

    expect(diagnostics.listDiagnostics().map((diagnostic) => diagnostic.id)).toEqual([
      'diagnostic_provider_memory_1000',
      'diagnostic_provider_git_1000',
      'diagnostic_provider_runtime_1000',
    ])
  })
})
