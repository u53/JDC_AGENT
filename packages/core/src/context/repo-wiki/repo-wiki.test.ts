import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { IndexStore } from '../../context-engine/graph/store.js'
import type { FileIndex, SymbolNode } from '../../context-engine/types.js'
import { buildRepoWikiEvidencePacket, generateRepoWikiEntries, retrieveRepoWikiEntries } from './index.js'
import type { RepoWikiModelClient } from './model-client.js'
import type { RepoWikiEntry } from './types.js'

function tmpRepo(): string {
  return path.join(tmpdir(), `jdc-repo-wiki-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

function indexedFile(filePath: string, hash: string, symbols: SymbolNode[] = []): FileIndex {
  return { filePath, language: 'typescript', hash, symbols, references: [], imports: [] }
}

function symbol(overrides: Partial<SymbolNode> = {}): SymbolNode {
  return {
    id: overrides.id ?? 'sym_session',
    name: overrides.name ?? 'Session',
    kind: overrides.kind ?? 'class',
    filePath: overrides.filePath ?? 'packages/core/src/session.ts',
    line: overrides.line ?? 1,
    column: overrides.column ?? 1,
    startLine: overrides.startLine ?? overrides.line ?? 1,
    endLine: overrides.endLine ?? overrides.line ?? 1,
    signature: overrides.signature,
  }
}

describe('repo wiki generation', () => {
  it('builds evidence packets from repo map, indexed files, docs, package scripts, and file hashes', () => {
    const cwd = tmpRepo()
    mkdirSync(path.join(cwd, 'packages/core/src'), { recursive: true })
    writeFileSync(path.join(cwd, 'README.md'), '# JDC\n\nRun pnpm test.\n')
    writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', build: 'tsc -b' } }))
    const sessionContent = 'export class Session {}\n'
    writeFileSync(path.join(cwd, 'packages/core/src/session.ts'), sessionContent)

    const store = new IndexStore()
    store.upsertFile(indexedFile('packages/core/src/session.ts', hashIndexedContent(sessionContent), [symbol({ signature: 'export class Session' })]))

    const packet = buildRepoWikiEvidencePacket({ cwd, indexStore: store, now: () => 1 })

    expect(packet.packets.map((item) => item.ref)).toContain('code-index')
    expect(packet.packets.map((item) => item.ref)).toContain('packages/core/src/session.ts')
    expect(packet.packets.map((item) => item.ref)).toContain('README.md')
    expect(packet.packets.map((item) => item.ref)).toContain('package.json')
    expect(packet.packets.find((item) => item.ref === 'packages/core/src/session.ts')?.hash).toBe(hashCurrentContent(sessionContent))
    expect(packet.packets.find((item) => item.ref === 'package.json')?.content).toContain('"test":"vitest"')
    expect(packet.evidenceHash).toMatch(/[a-f0-9]{64}/)
  })

  it('applies default repo map and packet size limits for large repositories', () => {
    const cwd = tmpRepo()
    mkdirSync(path.join(cwd, 'src'), { recursive: true })
    const docRefs = ['README.md', 'JDCAGNET.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'CONTRIBUTING.md', 'package.json', 'pnpm-workspace.yaml', 'turbo.json']
    for (const ref of docRefs) {
      writeFileSync(path.join(cwd, ref), ref === 'README.md' ? `${'a'.repeat(6_500)}TAIL_MARKER` : `${ref} evidence`)
    }

    const store = new IndexStore()
    for (let index = 0; index < 125; index += 1) {
      const filePath = `src/file-${String(index).padStart(3, '0')}.ts`
      const content = `export const value${index} = ${index}\n`
      writeFileSync(path.join(cwd, filePath), content)
      store.upsertFile(indexedFile(filePath, hashIndexedContent(content), [symbol({
        id: `sym_${index}`,
        name: `symbol${index}`,
        filePath,
      })]))
    }

    const packet = buildRepoWikiEvidencePacket({ cwd, indexStore: store, now: () => 1 })

    expect(packet.packets.filter((item) => item.ref.startsWith('src/file-'))).toHaveLength(120)
    expect(packet.packets.map((item) => item.ref)).toContain('turbo.json')
    expect(packet.packets.find((item) => item.ref === 'README.md')?.content).not.toContain('TAIL_MARKER')
    expect(packet.packets.find((item) => item.ref === 'README.md')?.content.length).toBeLessThanOrEqual(6_000)
  })

  it('respects caller-provided maxPacketChars and maxDocs overrides', () => {
    const cwd = tmpRepo()
    mkdirSync(path.join(cwd, 'src'), { recursive: true })
    writeFileSync(path.join(cwd, 'README.md'), `${'a'.repeat(6_500)}TAIL_MARKER`)
    writeFileSync(path.join(cwd, 'package.json'), '{"name":"test"}')

    const store = new IndexStore()
    const content = 'export const x = 1\n'
    writeFileSync(path.join(cwd, 'src/main.ts'), content)
    store.upsertFile(indexedFile('src/main.ts', hashIndexedContent(content)))

    const packet = buildRepoWikiEvidencePacket({ cwd, indexStore: store, maxPacketChars: 10_000, maxDocs: 1, now: () => 1 })

    expect(packet.packets.find((item) => item.ref === 'README.md')?.content).toContain('TAIL_MARKER')
    expect(packet.packets.map((item) => item.ref)).not.toContain('package.json')
  })

  it('skips indexed code packets when the current file hash disagrees with the index snapshot', () => {
    const cwd = tmpRepo()
    mkdirSync(path.join(cwd, 'src'), { recursive: true })
    writeFileSync(path.join(cwd, 'src/session.ts'), 'export class Session { current = true }\n')
    const store = new IndexStore()
    store.upsertFile(indexedFile('src/session.ts', hashIndexedContent('export class Session { stale = true }\n'), [symbol({ filePath: 'src/session.ts' })]))

    const packet = buildRepoWikiEvidencePacket({ cwd, indexStore: store, now: () => 1 })

    expect(packet.packets.map((item) => item.ref)).not.toContain('src/session.ts')
    expect(packet.diagnostics).toEqual([
      expect.objectContaining({
        level: 'warning',
        source: 'RepoWikiEvidence',
        message: expect.stringContaining('stale index packet for src/session.ts'),
      }),
    ])
  })

  it('accepts model sections only when every citation resolves to a packet hash and persists when a store is provided', async () => {
    const cwd = tmpRepo()
    mkdirSync(path.join(cwd, 'src'), { recursive: true })
    const mainContent = 'export function main() {}\n'
    writeFileSync(path.join(cwd, 'src/main.ts'), mainContent)
    const store = new IndexStore()
    store.upsertFile(indexedFile('src/main.ts', hashIndexedContent(mainContent), [symbol({
      id: 'sym_main',
      name: 'main',
      kind: 'function',
      filePath: 'src/main.ts',
      signature: 'export function main()',
    })]))
    const packet = buildRepoWikiEvidencePacket({ cwd, indexStore: store, now: () => 1 })
    const mainPacket = packet.packets.find((item) => item.ref === 'src/main.ts')!
    const modelClient: RepoWikiModelClient = {
      completeRepoWiki: vi.fn(async () => JSON.stringify({
        schemaVersion: 1,
        action: 'save',
        sections: [{
          kind: 'entrypoint',
          title: 'Runtime entry point',
          content: 'The main runtime starts from the exported main function.',
          citationPacketIds: [mainPacket.id],
          relatedFiles: ['src/main.ts'],
          relatedSymbols: ['main'],
          confidence: 0.9,
        }],
      })),
    }
    const repoWikiStore = { saveRepoWikiEntries: vi.fn(async () => ({ ok: true, value: { savedEntries: 1 }, diagnostics: [] })) }

    const generated = await generateRepoWikiEntries({
      cwd,
      projectKey: cwd,
      evidence: packet,
      modelClient,
      model: { providerProtocol: 'anthropic', modelId: 'claude-sonnet-4', modelProfileId: 'standard' },
      store: repoWikiStore,
      now: () => 2,
    })

    expect(generated.entries).toEqual([
      expect.objectContaining({
        kind: 'entrypoint',
        title: 'Runtime entry point',
        citations: [expect.objectContaining({ ref: 'src/main.ts', hash: hashCurrentContent(mainContent) })],
      }),
    ])
    expect(generated.diagnostics).toEqual([])
    expect(repoWikiStore.saveRepoWikiEntries).toHaveBeenCalledWith(generated.entries)
  })

  it('does not expose raw user identifiers in repo wiki model requests', async () => {
    const cwd = tmpRepo()
    mkdirSync(path.join(cwd, 'src'), { recursive: true })
    const content = 'export function session() {}\n'
    writeFileSync(path.join(cwd, 'src/session.ts'), content)
    const store = new IndexStore()
    store.upsertFile(indexedFile('src/session.ts', hashIndexedContent(content)))
    const packet = buildRepoWikiEvidencePacket({ cwd, indexStore: store, now: () => 1 })
    const sessionPacket = packet.packets.find((item) => item.ref === 'src/session.ts')!
    const modelClient: RepoWikiModelClient = {
      completeRepoWiki: vi.fn(async (request) => {
        expect(request.cacheUser).toBeDefined()
        expect(request.cacheUser).not.toBe('/Users/alice/private/project')
        expect(request.cacheUser).not.toContain('/Users/alice')
        return JSON.stringify({
          schemaVersion: 1,
          action: 'save',
          sections: [{
            kind: 'architecture',
            title: 'Session architecture',
            content: 'Session logic lives in src/session.ts.',
            citationPacketIds: [sessionPacket.id],
            relatedFiles: ['src/session.ts'],
            relatedSymbols: ['session'],
            confidence: 0.9,
          }],
        })
      }),
    }

    await generateRepoWikiEntries({
      cwd,
      projectKey: '/Users/alice/private/project',
      evidence: packet,
      modelClient,
      model: { providerProtocol: 'anthropic', modelId: 'claude-sonnet-4' },
      now: () => 1_700_000_000_000,
    })
  })

  it('rejects model sections that cite unknown evidence packets', async () => {
    const cwd = tmpRepo()
    mkdirSync(path.join(cwd, 'src'), { recursive: true })
    writeFileSync(path.join(cwd, 'src/main.ts'), 'export function main() {}\n')
    const store = new IndexStore()
    store.upsertFile(indexedFile('src/main.ts', 'hash_main'))
    const packet = buildRepoWikiEvidencePacket({ cwd, indexStore: store, now: () => 1 })
    const modelClient: RepoWikiModelClient = {
      completeRepoWiki: vi.fn(async () => JSON.stringify({
        schemaVersion: 1,
        action: 'save',
        sections: [{
          kind: 'architecture',
          title: 'Bad section',
          content: 'This section cites an unknown packet.',
          citationPacketIds: ['missing_packet'],
          relatedFiles: ['src/main.ts'],
          relatedSymbols: [],
          confidence: 0.9,
        }],
      })),
    }

    const generated = await generateRepoWikiEntries({
      cwd,
      projectKey: cwd,
      evidence: packet,
      modelClient,
      model: { providerProtocol: 'anthropic', modelId: 'claude-sonnet-4' },
      now: () => 2,
    })

    expect(generated.entries).toEqual([])
    expect(generated.diagnostics[0]?.message).toContain('unknown citation packet')
  })

  it('rejects empty citations, hidden reasoning markers, stale hash mismatches, and schema-invalid output with diagnostics', async () => {
    const cwd = tmpRepo()
    mkdirSync(path.join(cwd, 'src'), { recursive: true })
    const mainContent = 'export function main() {}\n'
    writeFileSync(path.join(cwd, 'src/main.ts'), mainContent)
    const store = new IndexStore()
    store.upsertFile(indexedFile('src/main.ts', hashIndexedContent(mainContent)))
    const packet = buildRepoWikiEvidencePacket({ cwd, indexStore: store, now: () => 1 })
    const mainPacket = packet.packets.find((item) => item.ref === 'src/main.ts')!

    const emptyCitations = await generateRepoWikiEntries({
      cwd,
      projectKey: cwd,
      evidence: packet,
      modelClient: { completeRepoWiki: vi.fn(async () => JSON.stringify({ schemaVersion: 1, action: 'save', sections: [{ kind: 'architecture', title: 'No citations', content: 'No proof.', citationPacketIds: [], relatedFiles: [], relatedSymbols: [], confidence: 0.8 }] })) },
      model: { providerProtocol: 'anthropic', modelId: 'claude-sonnet-4' },
      now: () => 2,
    })
    expect(emptyCitations.entries).toEqual([])
    expect(emptyCitations.diagnostics[0]?.message).toContain('schema-invalid')

    const hiddenReasoning = await generateRepoWikiEntries({
      cwd,
      projectKey: cwd,
      evidence: packet,
      modelClient: { completeRepoWiki: vi.fn(async () => JSON.stringify({ schemaVersion: 1, action: 'save', sections: [{ kind: 'architecture', title: 'Hidden', content: 'Hidden reasoning: first think secretly.', citationPacketIds: [mainPacket.id], relatedFiles: ['src/main.ts'], relatedSymbols: [], confidence: 0.8 }] })) },
      model: { providerProtocol: 'anthropic', modelId: 'claude-sonnet-4' },
      now: () => 3,
    })
    expect(hiddenReasoning.entries).toEqual([])
    expect(hiddenReasoning.diagnostics[0]?.message).toContain('hidden reasoning')

    writeFileSync(path.join(cwd, 'src/main.ts'), 'export function main() { return 1 }\n')
    const staleHash = await generateRepoWikiEntries({
      cwd,
      projectKey: cwd,
      evidence: packet,
      modelClient: { completeRepoWiki: vi.fn(async () => JSON.stringify({ schemaVersion: 1, action: 'save', sections: [{ kind: 'architecture', title: 'Stale', content: 'Main is the entry.', citationPacketIds: [mainPacket.id], relatedFiles: ['src/main.ts'], relatedSymbols: [], confidence: 0.8 }] })) },
      model: { providerProtocol: 'anthropic', modelId: 'claude-sonnet-4' },
      now: () => 4,
    })
    expect(staleHash.entries).toEqual([])
    expect(staleHash.diagnostics[0]?.message).toContain('stale hash')

    rmSync(path.join(cwd, 'src/main.ts'))
    const missingCitationFile = await generateRepoWikiEntries({
      cwd,
      projectKey: cwd,
      evidence: packet,
      modelClient: { completeRepoWiki: vi.fn(async () => JSON.stringify({ schemaVersion: 1, action: 'save', sections: [{ kind: 'architecture', title: 'Missing citation file', content: 'Main is the entry.', citationPacketIds: [mainPacket.id], relatedFiles: ['src/main.ts'], relatedSymbols: [], confidence: 0.8 }] })) },
      model: { providerProtocol: 'anthropic', modelId: 'claude-sonnet-4' },
      now: () => 4,
    })
    expect(missingCitationFile.entries).toEqual([])
    expect(missingCitationFile.diagnostics[0]?.message).toContain('missing citation file')

    const invalidSchema = await generateRepoWikiEntries({
      cwd,
      projectKey: cwd,
      evidence: packet,
      modelClient: { completeRepoWiki: vi.fn(async () => '{"schemaVersion":1,"action":"save","sections":[{"kind":"unknown"}]}') },
      model: { providerProtocol: 'anthropic', modelId: 'claude-sonnet-4' },
      now: () => 5,
    })
    expect(invalidSchema.entries).toEqual([])
    expect(invalidSchema.diagnostics[0]?.message).toContain('schema-invalid')
  })
})

describe('repo wiki retrieval', () => {
  it('scores entries by query, related files, related symbols, freshness/confidence, and evidence requirements', () => {
    const entries = retrieveRepoWikiEntries({
      query: '谁负责 Session 上下文注入',
      evidenceRequirements: [{
        id: 'req_code',
        kind: 'relevant_code',
        reason: 'Need target code',
        query: 'Session',
        priority: 'must',
        relatedFiles: ['packages/core/src/session.ts'],
        relatedSymbols: ['Session'],
        docRefs: [],
        languageHints: ['zh'],
      }],
      entries: [repoWikiEntry({
        id: 'wiki_session',
        kind: 'architecture',
        title: 'Session context injection',
        content: 'Session injects context before model calls.',
        citations: [{ id: 'cit', type: 'file', ref: 'packages/core/src/session.ts', hash: 'hash_session' }],
        relatedFiles: ['packages/core/src/session.ts'],
        relatedSymbols: ['Session'],
        confidence: 0.9,
        freshness: 'cached',
        updatedAt: 1,
      }), repoWikiEntry({
        id: 'wiki_low',
        kind: 'testing',
        title: 'Testing commands',
        content: 'Run tests with vitest.',
        citations: [{ id: 'cit_test', type: 'file', ref: 'package.json', hash: 'hash_package' }],
        relatedFiles: ['package.json'],
        relatedSymbols: [],
        confidence: 0.5,
        freshness: 'stale',
        updatedAt: 100,
      })],
    })

    expect(entries[0]).toMatchObject({
      entry: expect.objectContaining({ id: 'wiki_session' }),
      reasons: expect.arrayContaining(['query_match', 'requirement_file_match', 'requirement_symbol_match', 'confidence', 'freshness_cached']),
    })
    expect(entries.map((item) => item.entry.id)).not.toContain('wiki_low')
  })
})

function hashIndexedContent(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

function hashCurrentContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function repoWikiEntry(overrides: Partial<RepoWikiEntry> = {}): RepoWikiEntry {
  return {
    id: 'wiki_architecture',
    projectKey: '/repo',
    kind: 'architecture',
    title: 'Architecture overview',
    content: 'Session injects context before model calls.',
    citations: [{ id: 'cit', type: 'file', ref: 'packages/core/src/session.ts', hash: 'hash_session' }],
    relatedFiles: ['packages/core/src/session.ts'],
    relatedSymbols: ['Session'],
    confidence: 0.9,
    freshness: 'cached',
    generatedBy: { providerProtocol: 'anthropic', modelId: 'claude-sonnet-4' },
    evidenceHash: 'hash',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}
