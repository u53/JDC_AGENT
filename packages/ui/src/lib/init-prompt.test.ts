import { describe, expect, it } from 'vitest'
import { PROJECT_INIT_PROMPT } from './init-prompt'

describe('/init project prompt', () => {
  it('generates a project-level JDCAGNET.md contract with recovery and stale-task guards', () => {
    expect(PROJECT_INIT_PROMPT).toContain('project-level')
    expect(PROJECT_INIT_PROMPT).toContain('not product-level')
    expect(PROJECT_INIT_PROMPT).toContain('Doc Routing')
    expect(PROJECT_INIT_PROMPT).toContain('Compaction Recovery')
    expect(PROJECT_INIT_PROMPT).toContain('Do not resurrect completed, cancelled, or superseded tasks')
    expect(PROJECT_INIT_PROMPT).toContain('JdcContext')
    expect(PROJECT_INIT_PROMPT).toContain('JdcMemorySearch')
    expect(PROJECT_INIT_PROMPT).toContain('read it first')
  })
})
