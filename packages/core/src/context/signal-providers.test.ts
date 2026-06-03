import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ContextEngine } from '../context-engine/engine.js'
import { validateCitations } from './citations.js'
import { RawEvidenceSchema, ContextSectionSchema } from './schemas.js'
import type { ContextCitation, ContextFact, ContextRequest, RawEvidence } from './types.js'
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

  it('includes direct branch, short status, and recent log signals while preserving hot files', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'jdc-git-direct-provider-'))
    mkdirSync(join(cwd, 'packages/core/src/context'), { recursive: true })
    writeFileSync(join(cwd, 'packages/core/src/context/config.ts'), 'export const version = 1\n')
    execFileSync('git', ['init'], { cwd, stdio: 'ignore' })
    execFileSync('git', ['checkout', '-b', 'main'], { cwd, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.name', 'JDC Test'], { cwd, stdio: 'ignore' })
    execFileSync('git', ['add', 'packages/core/src/context/config.ts'], { cwd, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'initial context config'], { cwd, stdio: 'ignore' })
    writeFileSync(join(cwd, 'packages/core/src/context/config.ts'), 'export const version = 2\n')

    const result = await collectGitContext(request(cwd))
    const content = result.sections[0]?.content ?? ''

    expect(content).toContain('branch: main')
    expect(content).toContain('status:')
    expect(content).toContain('M packages/core/src/context/config.ts')
    expect(content).toContain('recent commits:')
    expect(content).toContain('initial context config')
    expect(content).toContain('Hot files:')
    expect(content).toContain('packages/core/src/context/config.ts')
    expectGateARecords(result)
    expectCitationsValid(sectionCitations(result), { gitEvidence: gitEvidenceSources(result.evidence) })
  })

  it('collects accepted project memories as cited memory context', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'jdc-memory-provider-store-'))
    const releaseFact: ContextFact = {
      id: 'fact_release',
      kind: 'workflow_rule',
      scope: 'project',
      content: '发布前必须运行 pnpm build。',
      citations: [{ id: 'cit_release', type: 'memory', ref: 'memory_release' }],
      confidence: 0.95,
      freshness: 'recent',
      sourceProvider: 'JdcMemoryWrite',
      createdAt: 1,
      updatedAt: 1,
    }
    const store = {
      listAcceptedProjectFacts: vi.fn(async () => ({ ok: true, value: [releaseFact], diagnostics: [] })),
    }

    const result = await collectMemoryContext(request(cwd, { userMessage: '发布流程是什么' }), { store: store as any })

    expect(store.listAcceptedProjectFacts).toHaveBeenCalledWith(expect.objectContaining({
      minConfidence: 0.01,
      includeStale: false,
      includeExpired: false,
      orderBy: 'updated_desc',
    }))
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]?.kind).toBe('memory')
    expect(result.sections[0]?.content).toContain('发布前必须运行 pnpm build')
    expect(result.sections[0]?.citations[0]?.ref).toBe('memory_release')
    expect(result.health.status).toBe('cached')
    expectGateARecords(result)
    expectCitationsValid(sectionCitations(result), { memoryRecords: [{ id: 'memory_release' }] })
  })

  it('does not impose a default accepted-memory count cap in the provider', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'jdc-memory-provider-unlimited-store-'))
    const facts = Array.from({ length: 75 }, (_, index): ContextFact => ({
      id: `fact_memory_${index}`,
      kind: 'project_convention',
      scope: 'project',
      content: `项目级上下文规则 ${index}`,
      citations: [{ id: `cit_memory_${index}`, type: 'memory', ref: `memory_${index}` }],
      confidence: 0.9,
      freshness: 'recent',
      sourceProvider: 'JdcMemoryWrite',
      createdAt: index,
      updatedAt: index,
    }))
    const store = {
      listAcceptedProjectFacts: vi.fn(async () => ({ ok: true, value: facts, diagnostics: [] })),
    }

    const result = await collectMemoryContext(request(cwd, { userMessage: '项目规则是什么' }), { store: store as any })

    expect(store.listAcceptedProjectFacts).toHaveBeenCalledWith(expect.not.objectContaining({ limit: expect.any(Number) }))
    expect(result.sections[0]?.content).toContain('项目级上下文规则 74')
  })

  it('keeps meaningful project docs beyond the first three non-empty lines', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'jdc-project-doc-provider-'))
    writeFileSync(join(cwd, 'JDCAGNET.md'), [
      '# JDCAGNET',
      '',
      '第一行简介。',
      '第二行简介。',
      '第三行简介。',
      '',
      '## 发布流程',
      '必须先运行 pnpm build，再打 tag。',
      '',
      '## 上下文引擎约定',
      'JDC Context Engine 数据必须按项目持久化。',
    ].join('\n'))

    const result = await collectProjectContext(request(cwd))

    expect(result.sections[0]?.content).toContain('发布流程')
    expect(result.sections[0]?.content).toContain('pnpm build')
    expect(result.sections[0]?.content).toContain('上下文引擎约定')
    expectGateARecords(result)
  })

  it('does not truncate project metadata files for local token budgeting', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'jdc-project-doc-full-provider-'))
    writeFileSync(join(cwd, 'JDCAGNET.md'), [
      '# JDCAGNET',
      ...Array.from({ length: 180 }, (_, index) => `项目规则 ${index}: 保留完整项目上下文。`),
      '最终规则: provider 不因为 token budget 截断项目文档。',
    ].join('\n'))

    const result = await collectProjectContext(request(cwd))

    expect(result.sections[0]?.content).toContain('项目规则 150')
    expect(result.sections[0]?.content).toContain('最终规则')
    expect(result.sections[0]?.content).not.toContain('truncated')
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
