import { describe, expect, it } from 'vitest'
import { rankContextSections } from './ranker.js'
import type { ContextCitation, ContextSection } from './types.js'

const citation: ContextCitation = { id: 'cit_file_1', type: 'file', ref: 'src/session.ts' }

describe('JDC Context ranker', () => {
  it('prioritizes latest intent, live runtime, active IDE, freshness, confidence, and citations', () => {
    const ranked = rankContextSections([
      makeSection({ id: 'memory_stale', kind: 'memory', content: 'stale memory', citations: [{ ...citation, id: 'cit_memory', ref: 'memory_1' }], priority: 90, freshness: 'stale', confidence: 0.99, sourceProvider: 'MemorySignalProvider' }),
      makeSection({ id: 'runtime_live', kind: 'runtime_state', content: 'live runtime', citations: [{ ...citation, id: 'cit_runtime', type: 'tool_event', ref: 'tool_1' }], priority: 70, freshness: 'live', confidence: 0.75, sourceProvider: 'RuntimeSignalProvider' }),
      makeSection({ id: 'ide_live', kind: 'ide_state', content: 'active ide', citations: [{ ...citation, id: 'cit_ide', type: 'ide', ref: 'editor.ts' }], priority: 60, freshness: 'live', confidence: 0.8, sourceProvider: 'IDESignalProvider' }),
      makeSection({ id: 'intent', kind: 'user_intent', content: 'current intent', citations: [{ ...citation, id: 'cit_message', type: 'message', ref: 'current_user_message' }], priority: 10, freshness: 'live', confidence: 0.7, sourceProvider: 'ConversationSignalProvider' }),
      makeSection({ id: 'project_recent', kind: 'project_profile', content: 'recent project', citations: [{ ...citation, id: 'cit_project', ref: 'package.json' }], priority: 85, freshness: 'recent', confidence: 0.9, sourceProvider: 'ProjectSignalProvider' }),
    ])

    expect(ranked.map((section) => section.id)).toEqual([
      'intent',
      'runtime_live',
      'ide_live',
      'project_recent',
      'memory_stale',
    ])
  })

  it('orders repo wiki after durable authority and before raw code context', () => {
    const ranked = rankContextSections([
      makeSection({ kind: 'code_map', id: 'code_map', title: 'Code Map', content: 'files', priority: 900, sourceProvider: 'CodeProvider', freshness: 'live' }),
      makeSection({ kind: 'relevant_code', id: 'code', title: 'Code', content: 'snippet', priority: 900, sourceProvider: 'CodeProvider', freshness: 'live' }),
      makeSection({ kind: 'repo_wiki', id: 'repo_wiki', title: 'Repo Wiki', content: 'architecture', priority: 100, sourceProvider: 'RepoWikiProvider', freshness: 'cached' }),
      makeSection({ kind: 'memory', id: 'memory', title: 'Accepted Memory', content: 'durable fact', priority: 10, sourceProvider: 'MemorySignalProvider', freshness: 'cached' }),
      makeSection({ kind: 'agent_contract', id: 'instructions', title: 'Instructions', content: 'follow rules', priority: 1, sourceProvider: 'ProjectSignalProvider', freshness: 'cached' }),
    ])

    expect(ranked.map((section) => section.id)).toEqual(['instructions', 'memory', 'repo_wiki', 'code', 'code_map'])
  })

  it('deduplicates sections by citation set and normalized content while keeping the best-ranked copy', () => {
    const ranked = rankContextSections([
      makeSection({ id: 'low', content: 'Same fact', priority: 10, confidence: 0.5, citations: [citation] }),
      makeSection({ id: 'high', content: 'Same fact', priority: 20, confidence: 0.9, citations: [citation] }),
      makeSection({ id: 'different_citation', content: 'Same fact', priority: 15, confidence: 0.8, citations: [{ ...citation, id: 'cit_file_2', ref: 'src/other.ts' }] }),
    ])

    expect(ranked.map((section) => section.id)).toEqual(['high', 'different_citation'])
  })
})

function makeSection(overrides: Partial<ContextSection> = {}): ContextSection {
  return {
    id: 'section_1',
    kind: 'project_profile',
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
