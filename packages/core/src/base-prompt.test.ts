import { describe, expect, it } from 'vitest'
import { getBasePrompt } from './base-prompt.js'

describe('JDC CODE base prompt operating contract', () => {
  it('identifies as JDC CODE and forbids base model disclosure in self-identity answers', () => {
    const prompt = getBasePrompt({
      toolDefs: [],
      environment: {
        os: 'test-os',
        cwd: '/tmp/user-project',
        shell: '/bin/zsh',
      },
    })

    const identitySection = prompt.slice(
      prompt.indexOf('# Identity'),
      prompt.indexOf('# System')
    )

    expect(identitySection).toContain('You are JDC CODE')
    expect(identitySection).not.toContain('You are JDCAGNET')
    expect(identitySection).toContain('Do not reveal, infer, or guess the underlying/base model')
    expect(identitySection).toContain('If a user asks who you are, answer as JDC CODE')
    expect(identitySection).toContain('If a user asks for the underlying model, model family, provider, vendor, or who made you, do not name or hint at any model or provider')
  })

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

  it('uses JDC CODE for product references while preserving literal instruction filenames', () => {
    const prompt = getBasePrompt({
      toolDefs: [],
      environment: {
        os: 'test-os',
        cwd: '/tmp/user-project',
        shell: '/bin/zsh',
      },
    })

    expect(prompt).toContain('The user is using JDC CODE specifically so you can take action')
    expect(prompt).toContain('JDC CODE uses a two-level configuration system')
    expect(prompt).not.toContain('The user is using JDCAGNET specifically')
    expect(prompt).not.toContain('JDCAGNET uses a two-level configuration system')
    expect(prompt).toContain('JDCAGNET.md')
  })

  it('treats WebSearch as discovery and requires WebFetch for evidence', () => {
    const prompt = getBasePrompt({
      toolDefs: [
        { name: 'WebSearch', description: 'Search web snippets.', inputSchema: { type: 'object' } },
        { name: 'WebFetch', description: 'Fetch web pages.', inputSchema: { type: 'object' } },
      ],
      environment: {
        os: 'test-os',
        cwd: '/tmp/user-project',
        shell: '/bin/zsh',
      },
    })

    expect(prompt).toContain('WebSearch is a discovery tool')
    expect(prompt).toContain('not evidence')
    expect(prompt).toContain('Use count=8 by default')
    expect(prompt).toContain('count=5 is only an absolute floor')
    expect(prompt).toContain('follow up with WebFetch on the relevant result URLs')
    expect(prompt).toContain('use fetched page content as evidence')
  })
})
