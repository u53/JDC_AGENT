// packages/core/tests/context.test.ts
import { describe, it, expect } from 'vitest'
import { assembleSystemPrompt, joinSegments, loadProjectMd } from '../src/context.js'

describe('context', () => {
  it('assembles system prompt with base prompt', async () => {
    const segments = await assembleSystemPrompt({
      cwd: '/tmp/test',
      toolDefs: [
        { name: 'bash', description: 'Run shell commands', inputSchema: { type: 'object' } },
        { name: 'file_read', description: 'Read files', inputSchema: { type: 'object' } },
      ],
      toolNames: ['bash', 'file_read'],
    })
    const prompt = joinSegments(segments)
    expect(prompt).toContain('JDC CODE')
    expect(prompt).toContain('bash')
    expect(prompt).toContain('file_read')
  })

  it('includes current date', async () => {
    const segments = await assembleSystemPrompt({ cwd: '/tmp', toolDefs: [], toolNames: [] })
    const prompt = joinSegments(segments)
    const today = new Date().toISOString().split('T')[0]
    expect(prompt).toContain(today)
  })

  it('returns segments with correct cacheable flags', async () => {
    const segments = await assembleSystemPrompt({ cwd: '/tmp', toolDefs: [], toolNames: [] })
    expect(segments.length).toBeGreaterThan(0)
    // Last segment (dynamic: git+date) should not be cacheable
    const lastSegment = segments[segments.length - 1]
    expect(lastSegment.cacheable).toBe(false)
    // All other segments should be cacheable
    for (const seg of segments.slice(0, -1)) {
      expect(seg.cacheable).toBe(true)
    }
  })

  it('includes user preferences when language is set', async () => {
    const segments = await assembleSystemPrompt({
      cwd: '/tmp',
      toolDefs: [],
      toolNames: [],
      language: 'zh-CN',
    })
    const prompt = joinSegments(segments)
    expect(prompt).toContain('User Preferences')
    expect(prompt).toContain('中文')
  })

  it('loadProjectMd returns null for missing file', async () => {
    const md = await loadProjectMd('/tmp/nonexistent-dir-xyz-abc')
    expect(md).toBeNull()
  })
})
