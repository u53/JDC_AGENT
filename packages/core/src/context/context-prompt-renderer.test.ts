import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assembleSystemPrompt } from '../context.js'
import { renderContextBundle } from './prompt-renderer.js'
import type { ContextBundle, ContextCitation, ContextSection } from './types.js'

const citation: ContextCitation = { id: 'cit_file_1', type: 'file', ref: 'src/file.ts', line: 12 }
const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
  tmpDirs.length = 0
})

describe('JDC Context prompt renderer', () => {
  it('does not inject legacy file-based MEMORY.md instructions or index into the system prompt', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'jdc-context-prompt-'))
    tmpDirs.push(cwd)

    const segments = await assembleSystemPrompt({ cwd, toolDefs: [], toolNames: [] })
    const prompt = segments.map((segment) => segment.content).join('\n')

    expect(prompt).not.toContain('persistent, file-based memory system')
    expect(prompt).not.toContain('Current memory index (MEMORY.md)')
    expect(prompt).not.toContain('How to save memories')
  })

  it('renders a protocol-neutral JDC Context Engine XML block with required section attributes and compact citations', () => {
    const rendered = renderContextBundle(makeBundle())

    expect(rendered).toMatch(/^<jdc-context-engine bundle="ctx_[0-9a-f]{16}">/)
    expect(rendered).toContain('<section kind="runtime_state" confidence="0.91" freshness="live" source="RuntimeSignalProvider">')
    expect(rendered).toContain('Recent tool error chain')
    expect(rendered).toContain('<citations>')
    expect(rendered).toContain('- cit_file_1: file src/file.ts:12')
    expect(rendered).toContain('</jdc-context-engine>')
    expect(rendered).not.toContain('role')
    expect(rendered).not.toContain('messages')
    expect(rendered).not.toContain('anthropic')
    expect(rendered).not.toContain('openai')
  })

  it('renders identical context content identically despite volatile bundle metadata', () => {
    const first = renderContextBundle(makeBundle({ id: 'bundle_first', createdAt: 1_000 }))
    const second = renderContextBundle(makeBundle({ id: 'bundle_second', createdAt: 2_000 }))

    expect(first).toBe(second)
  })

  it('omits the prompt block when context injection is disabled', () => {
    expect(renderContextBundle(makeBundle(), { injectionEnabled: false })).toBe('')
  })

  it('escapes XML-sensitive content and redacts common secret patterns before rendering', () => {
    const rendered = renderContextBundle(makeBundle({
      sections: [makeSection({ content: 'Use <tag> & token sk-test-1234567890abcdef for raw check' })],
    }))

    expect(rendered).toContain('Use &lt;tag&gt; &amp; token [redacted secret] for raw check')
    expect(rendered).not.toContain('sk-test-1234567890abcdef')
  })

  it('redacts raw model thinking and chain-of-thought markers before rendering context content', () => {
    const rendered = renderContextBundle(makeBundle({
      sections: [makeSection({
        content: 'raw thinking: hidden chain of thought should not appear\nreasoning_summary: model-only notes',
      })],
    }))

    expect(rendered).toContain('[redacted protected model-thought]')
    expect(rendered).not.toContain('raw thinking')
    expect(rendered).not.toContain('chain of thought')
    expect(rendered).not.toContain('reasoning_summary')
    expect(rendered).not.toContain('model-only notes')
  })
})

function makeBundle(overrides: Partial<ContextBundle> = {}): ContextBundle {
  const section = makeSection()
  return {
    id: 'bundle_1',
    sessionId: 'session_1',
    requestHash: 'request_hash_1',
    createdAt: 1_000,
    sections: [section],
    citations: section.citations,
    diagnostics: [],
    budget: { usedTokens: 10, droppedTokens: 0 },
    ...overrides,
  }
}

function makeSection(overrides: Partial<ContextSection> = {}): ContextSection {
  return {
    id: 'runtime_1',
    kind: 'runtime_state',
    title: 'Runtime state',
    content: 'Recent tool error chain',
    citations: [citation],
    priority: 90,
    confidence: 0.91,
    freshness: 'live',
    sourceProvider: 'RuntimeSignalProvider',
    tokenEstimate: 10,
    ...overrides,
  }
}
