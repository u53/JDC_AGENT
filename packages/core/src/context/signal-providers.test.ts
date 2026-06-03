import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ContextEngine } from '../context-engine/engine.js'
import { validateCitations } from './citations.js'
import { RawEvidenceSchema, ContextSectionSchema } from './schemas.js'
import type { ContextCitation, ContextRequest, RawEvidence } from './types.js'
import { collectCodeContext } from './providers/code-provider.js'
import { collectConversationContext } from './providers/conversation-provider.js'
import { collectGitContext } from './providers/git-provider.js'
import { collectIdeContext } from './providers/ide-provider.js'
import { collectMemoryContext } from './providers/memory-provider.js'
import { collectProjectContext } from './providers/project-provider.js'
import { collectRuntimeContext } from './providers/runtime-provider.js'

function request(cwd: string, overrides: Partial<ContextRequest> = {}): ContextRequest {
  return {
    sessionId: 'session_1',
    cwd,
    userMessage: 'Find bootstrapApp and explain the runtime failure.',
    recentMessages: [
      { id: 'msg_user', role: 'user', content: [{ type: 'text', text: 'Find bootstrapApp.' }], timestamp: 1 },
      {
        id: 'msg_assistant',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'private chain of thought must not persist' } as any,
          { type: 'text', text: 'I will inspect the entry point.' },
        ],
        timestamp: 2,
      },
    ],
    mode: 'code_edit',
    model: 'gpt-5.5',
    tokenBudget: 1200,
    runtime: {},
    createdAt: 3,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function expectGateARecords(result: { evidence: unknown[]; sections: unknown[] }) {
  for (const evidence of result.evidence) expect(RawEvidenceSchema.safeParse(evidence).success).toBe(true)
  for (const section of result.sections) expect(ContextSectionSchema.safeParse(section).success).toBe(true)
}

function sectionCitations(result: { sections: Array<{ citations: ContextCitation[] }> }): ContextCitation[] {
  return result.sections.flatMap((section) => section.citations)
}

function expectCitationsValid(citations: ContextCitation[], sources: Parameters<typeof validateCitations>[1]) {
  const validation = validateCitations(citations, sources)
  expect(validation).toEqual({ valid: true, errors: [] })
}

function gitEvidenceSources(evidence: RawEvidence[]) {
  return evidence.filter((item) => item.kind === 'git').map((item) => ({ id: item.id, ref: item.id, hash: item.hash }))
}

function evidenceProofSources(evidence: RawEvidence[]) {
  return {
    retainedFileSnapshots: evidence.filter((item) => item.kind === 'file').map((item) => ({ ref: String(item.metadata.file ?? item.id), hash: item.hash })),
    configEvidence: evidence.filter((item) => item.kind === 'config').map((item) => ({ id: item.id, ref: String(item.metadata.file ?? item.id) })),
    ideEvidence: evidence.filter((item) => item.kind === 'ide').map((item) => ({ id: item.id, ref: typeof item.metadata.ide === 'object' && item.metadata.ide && 'activeFile' in item.metadata.ide ? String((item.metadata.ide as { activeFile?: unknown }).activeFile ?? item.id) : item.id })),
  }
}

describe('context signal providers', () => {
  it('wraps the existing JDC code engine without changing Jdc* tools', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'jdc-code-provider-'))
    mkdirSync(join(cwd, 'src'))
    writeFileSync(join(cwd, 'src', 'app.ts'), 'export function bootstrapApp() { return helper() }\nfunction helper() { return true }\n')

    const engine = new ContextEngine(cwd)
    await engine.index()

    const result = await collectCodeContext(request(cwd, { userMessage: 'bootstrapApp' }), {
      contextEngine: engine,
      maxNodes: 5,
    })

    expect(result.health).toMatchObject({ id: 'code', status: 'enabled' })
    expect(result.sections.some((section) => section.kind === 'relevant_code' && section.content.includes('bootstrapApp'))).toBe(true)
    expect(result.evidence.some((evidence) => evidence.kind === 'file' && evidence.sourceProvider === 'CodeSignalProvider')).toBe(true)
    expectGateARecords(result)
    expectCitationsValid(sectionCitations(result), { cwd })
    expect(sectionCitations(result).every((citation) => citation.hash === undefined)).toBe(true)
  })

  it('returns cached-only code health without starting indexing when the engine is not indexed', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'jdc-code-provider-cached-'))
    const releaseIndex = deferred<void>()
    const engine = {
      isIndexed: vi.fn(() => false),
      index: vi.fn(() => releaseIndex.promise),
    }

    const result = await collectCodeContext(request(cwd, { userMessage: 'bootstrapApp' }), {
      contextEngine: engine as any,
    })

    expect(result.health).toMatchObject({ id: 'code', status: 'not_indexed' })
    expect(result.health.backgroundJob).toBeUndefined()
    expect(result.health.diagnostic?.message).toContain('explicit reindex')
    expect(result.sections).toEqual([])
    expect(result.evidence).toEqual([])
    expect(engine.index).not.toHaveBeenCalled()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(engine.index).not.toHaveBeenCalled()
    releaseIndex.resolve()
  })

  it('queues explicit code reindex after returning cached health when the engine is not indexed', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'jdc-code-provider-unindexed-'))
    const releaseIndex = deferred<void>()
    const engine = {
      isIndexed: vi.fn(() => false),
      index: vi.fn(() => releaseIndex.promise),
    }

    const result = await collectCodeContext(request(cwd, { userMessage: 'bootstrapApp' }), {
      contextEngine: engine as any,
      reindex: true,
    })

    expect(result.health).toMatchObject({ id: 'code', status: 'indexing', backgroundJob: { status: 'queued' } })
    expect(result.health.diagnostic?.message).toContain('queued')
    expect(result.sections).toEqual([])
    expect(result.evidence).toEqual([])
    expect(engine.index).not.toHaveBeenCalled()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(engine.index).toHaveBeenCalledTimes(1)

    releaseIndex.resolve()
    await releaseIndex.promise
  })

  it('collects project and git signals while legacy file-based memory stays retired', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'jdc-project-provider-'))
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'vitest' } }))
    execFileSync('git', ['init'], { cwd, stdio: 'ignore' })
    writeFileSync(join(cwd, 'changed.ts'), 'export const changed = true\n')

    const memoryDir = mkdtempSync(join(tmpdir(), 'jdc-memory-provider-'))
    writeFileSync(join(memoryDir, 'MEMORY.md'), '- [Use TDD](use-tdd.md) — User wants test-first changes\n')
    writeFileSync(join(memoryDir, 'use-tdd.md'), 'Always write failing tests before implementation.\n')

    const project = await collectProjectContext(request(cwd))
    const git = await collectGitContext(request(cwd))
    const memory = await collectMemoryContext(request(cwd), { memoryDir })

    expect(project.health).toMatchObject({ id: 'project', status: 'enabled' })
    expect(git.health).toMatchObject({ id: 'git', status: 'enabled' })
    expect(memory.health).toMatchObject({ id: 'memory', status: 'cached' })
    expect(project.sections[0].content).toContain('fixture')
    expect(git.sections[0].content).toContain('changed.ts')
    expect(memory.sections).toEqual([])
    expect(memory.evidence).toEqual([])
    ;[project, git].forEach(expectGateARecords)
    expectCitationsValid(sectionCitations(project), { cwd, ...evidenceProofSources(project.evidence) })
    expectCitationsValid(sectionCitations(git), { gitEvidence: gitEvidenceSources(git.evidence) })
    expect(sectionCitations(project).every((citation) => citation.hash === undefined)).toBe(true)
  })

  it('collects conversation, runtime, and IDE signals without persisting raw thinking', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'jdc-live-provider-'))
    const liveRequest = request(cwd, {
      runtime: { toolEvents: [{ id: 'tool_1', name: 'Read', status: 'error', message: 'missing file' }, { id: 'tool_2', name: 'JdcSearch', status: 'cancelled', message: 'sibling failed' }] },
      ide: { activeFile: 'src/app.ts', selection: { text: 'bootstrapApp()', startLine: 4, endLine: 4 }, diagnostics: [{ message: 'Type mismatch', severity: 'error' }] },
    })

    const conversation = collectConversationContext(liveRequest)
    const runtime = collectRuntimeContext(liveRequest)
    const ide = collectIdeContext(liveRequest)

    expect(conversation.sections[0].content).toContain('Find bootstrapApp')
    expect(conversation.sections[0].content).not.toContain('private chain of thought')
    expect(runtime.sections[0].content).toContain('Read')
    expect(runtime.sections[0].content).toContain('cancelled')
    expect(ide.sections[0].content).toContain('src/app.ts')
    ;[conversation, runtime, ide].forEach((result) => {
      expect(result.health.status).toBe('enabled')
      expectGateARecords(result)
    })
    expectCitationsValid(sectionCitations(conversation), { messages: [...liveRequest.recentMessages.map((message) => ({ id: message.id })), { id: 'current_user_message' }] })
    expectCitationsValid(sectionCitations(runtime), { toolEvents: runtime.evidence.map((item) => ({ id: String(item.metadata.eventId) })) })
    expectCitationsValid(sectionCitations(ide), evidenceProofSources(ide.evidence))
    expect(sectionCitations(conversation).every((citation) => citation.hash === undefined)).toBe(true)
    expect(sectionCitations(runtime).every((citation) => citation.hash === undefined)).toBe(true)
    expect(sectionCitations(ide).every((citation) => citation.hash === undefined)).toBe(true)
  })

  it('formats ToolRunner-shaped runtime events and preserves real tool error details', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'jdc-runtime-provider-'))
    const runtime = collectRuntimeContext(request(cwd, {
      runtime: {
        toolEvents: [
          { type: 'start', toolName: 'Read', toolUseId: 'tool_read_1', input: { file_path: 'missing.ts' } },
          { type: 'error', toolName: 'Read', toolUseId: 'tool_read_1', result: { content: 'ENOENT: no such file or directory, open missing.ts', isError: true } },
        ],
      },
    }))

    expect(runtime.sections[0].content).toContain('Read start (tool_read_1)')
    expect(runtime.sections[0].content).toContain('Read error (tool_read_1) — ENOENT: no such file or directory, open missing.ts')
    expect(runtime.evidence.map((item) => item.metadata.eventId)).toEqual(['tool_read_1', 'tool_read_1'])
    expectCitationsValid(sectionCitations(runtime), { toolEvents: [{ id: 'tool_read_1' }] })
  })

  it('reports stale, failed, and rate-limited provider health with degraded diagnostics', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'jdc-degraded-provider-'))

    const staleGit = await collectGitContext(request(cwd))
    const staleIde = collectIdeContext(request(cwd))
    const failedCode = await collectCodeContext(request(cwd), { getContextEngine: () => { throw new Error('engine unavailable') } })
    const rateLimitedProject = await collectProjectContext(request(cwd), { rateLimited: true })

    expect(staleGit.health.status).toBe('stale')
    expect(staleIde.health.status).toBe('stale')
    expect(failedCode.health.status).toBe('failed')
    expect(rateLimitedProject.health.status).toBe('rate_limited')
    expect(staleGit.diagnostics[0].level).toBe('warning')
    expect(staleIde.diagnostics[0].message).toContain('IDE snapshot is unavailable')
    expect(failedCode.diagnostics[0].message).toContain('engine unavailable')
    expect(rateLimitedProject.diagnostics[0].message).toContain('rate-limited')
  })
})
