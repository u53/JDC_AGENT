// packages/core/tests/context.test.ts
import { describe, it, expect } from 'vitest'
import { assembleSystemPrompt, loadProjectMd } from '../src/context.js'

describe('context', () => {
  it('assembles system prompt with base prompt', async () => {
    const prompt = await assembleSystemPrompt({
      cwd: '/tmp/test',
      toolDefs: [
        { name: 'bash', description: 'Run shell commands', inputSchema: { type: 'object' } },
        { name: 'file_read', description: 'Read files', inputSchema: { type: 'object' } },
      ],
      toolNames: ['bash', 'file_read'],
    })
    expect(prompt).toContain('JDCAGNET')
    expect(prompt).toContain('bash')
    expect(prompt).toContain('file_read')
  })

  it('includes current date', async () => {
    const prompt = await assembleSystemPrompt({ cwd: '/tmp', toolDefs: [], toolNames: [] })
    const today = new Date().toISOString().split('T')[0]
    expect(prompt).toContain(today)
  })

  it('loadProjectMd returns null for missing file', async () => {
    const md = await loadProjectMd('/tmp/nonexistent-dir-xyz-abc')
    expect(md).toBeNull()
  })
})
