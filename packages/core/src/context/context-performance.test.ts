import { describe, expect, it } from 'vitest'
import { createContextPerformanceRecorder, recordContextOperation, summarizeContextPerformance } from './performance.js'

describe('JDC Context Engine performance metrics', () => {
  it('summarizes operation counts, percentiles, and metadata without wall-clock assumptions', () => {
    const recorder = createContextPerformanceRecorder({ maxOperations: 10 })

    recorder.record({ name: 'context:retrieve-facts', lane: 'foreground', status: 'success', startedAt: 1_000, completedAt: 1_020, projectKey: '/repo', metadata: { factCount: 120 } })
    recorder.record({ name: 'context:retrieve-facts', lane: 'foreground', status: 'success', startedAt: 1_020, completedAt: 1_080, projectKey: '/repo', metadata: { factCount: 80 } })
    recorder.record({ name: 'context:harvest', lane: 'background', status: 'timeout', startedAt: 2_000, completedAt: 2_500, projectKey: '/repo', metadata: { runLoopId: 'run-1' } })

    const summary = summarizeContextPerformance(recorder.snapshot())

    expect(summary.totalOperations).toBe(3)
    expect(summary.byStatus.success).toBe(2)
    expect(summary.byStatus.timeout).toBe(1)
    expect(summary.byName['context:retrieve-facts']).toMatchObject({ count: 2, p50Ms: 20, p95Ms: 60, maxMs: 60 })
    expect(summary.slowest[0]).toMatchObject({ name: 'context:harvest', durationMs: 500, metadata: { runLoopId: 'run-1' } })
  })

  it('records async operation success and failure with metadata', async () => {
    let clock = 10
    const recorder = createContextPerformanceRecorder({ now: () => clock })

    const value = await recordContextOperation(recorder, {
      name: 'context:pack-assemble',
      lane: 'foreground',
      projectKey: '/repo',
      metadata: { sectionCount: 3 },
      now: () => clock,
    }, async () => {
      clock = 42
      return 'ok'
    })

    await expect(recordContextOperation(recorder, {
      name: 'context:store-write',
      lane: 'storage',
      projectKey: '/repo',
      now: () => clock,
    }, async () => {
      clock = 50
      throw new Error('db export failed')
    })).rejects.toThrow('db export failed')

    expect(value).toBe('ok')
    expect(recorder.snapshot().operations.map((operation) => operation.status)).toEqual(['success', 'failed'])
    expect(recorder.snapshot().operations[1].diagnostic).toBe('db export failed')
  })
})
