import { describe, expect, it } from 'vitest'
import { budgetContextSections } from './budgeter.js'
import type { ContextCitation, ContextSection } from './types.js'

const citation: ContextCitation = { id: 'cit_file_1', type: 'file', ref: 'src/file.ts' }

describe('JDC Context budgeter', () => {
  it('keeps highest-ranked sections within the bundle budget and reports dropped token cost', () => {
    const result = budgetContextSections([
      makeSection({ id: 'intent', tokenEstimate: 30 }),
      makeSection({ id: 'runtime', tokenEstimate: 40 }),
      makeSection({ id: 'memory', tokenEstimate: 80 }),
    ], { maxTokens: 100, maxSectionTokens: 100, maxCodeTokens: 100 })

    expect(result.sections.map((section) => section.id)).toEqual(['intent', 'runtime'])
    expect(result.budget).toEqual({ maxTokens: 100, usedTokens: 70, droppedTokens: 80 })
    expect(result.dropped.map((drop) => [drop.section.id, drop.reason, drop.tokenEstimate])).toEqual([
      ['memory', 'bundle_token_budget_exceeded', 80],
    ])
  })

  it('truncates oversized sections with source-specific limits before applying the bundle budget', () => {
    const result = budgetContextSections([
      makeSection({ id: 'code', kind: 'relevant_code', tokenEstimate: 500, content: 'x '.repeat(1200) }),
      makeSection({ id: 'project', kind: 'project_profile', tokenEstimate: 300, content: 'p '.repeat(800) }),
    ], { maxTokens: 350, maxSectionTokens: 120, maxCodeTokens: 200 })

    expect(result.sections.map((section) => [section.id, section.tokenEstimate])).toEqual([
      ['code', 200],
      ['project', 120],
    ])
    expect(result.budget).toEqual({ maxTokens: 350, usedTokens: 320, droppedTokens: 480 })
    expect(result.dropped.map((drop) => [drop.section.id, drop.reason, drop.tokenEstimate])).toEqual([
      ['code', 'section_truncated', 300],
      ['project', 'section_truncated', 180],
    ])
    expect(result.sections[0]?.content).toContain('[truncated by JDC Context Engine]')
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
