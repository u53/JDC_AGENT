import { describe, expect, it } from 'vitest'
import { budgetContextSections } from './budgeter.js'
import type { ContextCitation, ContextSection } from './types.js'

const citation: ContextCitation = { id: 'cit_file_1', type: 'file', ref: 'src/file.ts' }

describe('JDC Context budgeter', () => {
  it('keeps every section and records token usage even when legacy bundle caps are present', () => {
    const result = budgetContextSections([
      makeSection({ id: 'intent', tokenEstimate: 30 }),
      makeSection({ id: 'runtime', tokenEstimate: 40 }),
      makeSection({ id: 'memory', tokenEstimate: 80 }),
    ], { maxTokens: 100, maxSectionTokens: 100, maxCodeTokens: 100 })

    expect(result.sections.map((section) => section.id)).toEqual(['intent', 'runtime', 'memory'])
    expect(result.budget).toEqual({ maxTokens: 100, usedTokens: 150, droppedTokens: 0 })
    expect(result.dropped).toEqual([])
  })

  it('does not truncate oversized sections with source-specific legacy caps', () => {
    const result = budgetContextSections([
      makeSection({ id: 'code', kind: 'relevant_code', tokenEstimate: 500, content: 'x '.repeat(1200) }),
      makeSection({ id: 'project', kind: 'project_profile', tokenEstimate: 300, content: 'p '.repeat(800) }),
    ], { maxTokens: 350, maxSectionTokens: 120, maxCodeTokens: 200 })

    expect(result.sections.map((section) => [section.id, section.tokenEstimate])).toEqual([
      ['code', 500],
      ['project', 300],
    ])
    expect(result.budget).toEqual({ maxTokens: 350, usedTokens: 800, droppedTokens: 0 })
    expect(result.dropped).toEqual([])
    expect(result.sections[0]?.content).not.toContain('[truncated by JDC Context Engine]')
  })
})

function makeSection(overrides: Partial<ContextSection> = {}): ContextSection {
  return {
    id: 'section_1',
    kind: 'memory',
    title: 'Section',
    content: 'Context content',
    citations: [citation],
    priority: 50,
    confidence: 0.8,
    freshness: 'recent',
    sourceProvider: 'TestProvider',
    tokenEstimate: 20,
    ...overrides,
  }
}
