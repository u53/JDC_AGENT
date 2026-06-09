import { describe, expect, it } from 'vitest'
import { getBasePrompt } from './base-prompt.js'

describe('JDC CODE base prompt operating contract', () => {
  it('ships product-level operating constraints without relying on project JDCAGNET.md', () => {
    const prompt = getBasePrompt({
      toolDefs: [
        { name: 'JdcContext', description: 'Build code context.', inputSchema: { type: 'object' } },
        { name: 'JdcMemorySearch', description: 'Search project memories.', inputSchema: { type: 'object' } },
        { name: 'LSP', description: 'Language Server Protocol.', inputSchema: { type: 'object' } },
        { name: 'Read', description: 'Read files.', inputSchema: { type: 'object' } },
      ],
      environment: {
        os: 'test-os',
        cwd: '/tmp/user-project-without-jdcagnet-md',
        shell: '/bin/zsh',
      },
    })

    expect(prompt).toContain('# JDC CODE Operating Contract')
    expect(prompt).toContain('This section is built into JDC CODE')
    expect(prompt).toContain('Do not depend on a project JDCAGNET.md file for these product-level rules')
    expect(prompt).toContain('After compaction')
    expect(prompt).toContain('JdcContext is the first code-understanding tool')
    expect(prompt).toContain('JdcMemorySearch is the durable project-memory lookup')
    expect(prompt).toContain('Treat JDC Context Engine as the strategic code-understanding entrypoint and LSP as a last-mile precision tool')
    expect(prompt).toContain('Do not use LSP for broad project exploration, file browsing, or replacing JdcContext/JdcSearch/JdcFiles')
    expect(prompt).toContain('doc routing')
  })
})
