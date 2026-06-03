import { describe, expect, it } from 'vitest'
import {
  GATE_F_CONTEXT_EVAL_COMMAND,
  assertContextEvalReportPassed,
  formatContextEvalReport,
  runContextEvalSuite,
  runGateFContextEvals,
} from './evals/index.js'

describe('JDC Context Engine Gate F eval harness', () => {
  it('runs production-readiness context evals as one inspectable report', async () => {
    const report = await runGateFContextEvals()

    assertContextEvalReportPassed(report)

    expect(report.gate).toBe('Gate F Production Candidate')
    expect(report.command).toBe(GATE_F_CONTEXT_EVAL_COMMAND)
    expect(report.summary.failed).toBe(0)
    expect(report.summary.total).toBeGreaterThanOrEqual(13)
    expect(report.cases.map((result) => result.id)).toEqual(expect.arrayContaining([
      'context-relevant-file-recall',
      'context-stale-memory-not-live',
      'context-runtime-error-chain',
      'context-token-budget',
      'product-cross-session-project-fact',
      'product-model-noop-not-primary-context',
      'product-foreground-context-budget',
      'store-schema-migration',
      'store-schema-rebuild',
      'store-failure-fallback',
      'store-quota-readiness',
      'regression-jdc-tools',
      'regression-model-protocols',
      'feature-disable-fallback',
      'safety-durable-citations',
      'safety-no-raw-thinking-persistence',
      'safety-greeting-no-new-fact-skip',
      'safety-redaction-before-distillation',
    ]))
    expect(formatContextEvalReport(report)).toContain('Gate F Production Candidate')
    expect(formatContextEvalReport(report)).toContain('regression-model-protocols')
  })

  it('reports failing eval cases without throwing so Gate F artifacts stay inspectable', async () => {
    const report = await runContextEvalSuite([
      {
        id: 'expected-failure',
        category: 'safety',
        name: 'Expected failure',
        run: async () => {
          throw new Error('intentional eval failure')
        },
      },
    ])

    expect(report.summary).toMatchObject({ total: 1, passed: 0, failed: 1 })
    expect(report.cases[0]).toMatchObject({ id: 'expected-failure', status: 'failed' })
    expect(report.cases[0]?.errors).toEqual(['intentional eval failure'])
  })
})
