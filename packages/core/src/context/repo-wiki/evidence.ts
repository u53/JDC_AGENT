import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { hashContent as hashCurrentFileContent } from '../providers/shared.js'
import { buildRepoMap, renderRepoMap } from '../../context-engine/repo-map.js'
import { hashContent as hashIndexedFileContent } from '../../context-engine/parser/parser.js'
import type { ContextDiagnostic } from '../types.js'
import type { IndexStore } from '../../context-engine/graph/store.js'
import type { RepoWikiEvidencePacket } from './types.js'

export interface RepoWikiEvidenceInput {
  cwd: string
  indexStore: Pick<IndexStore, 'allFiles'>
  now?: () => number
  maxDocs?: number
  maxPacketChars?: number
}

export interface RepoWikiEvidenceBundle {
  packets: RepoWikiEvidencePacket[]
  evidenceHash: string
  createdAt: number
  diagnostics: ContextDiagnostic[]
}

const DOC_CANDIDATES = [
  'README.md',
  'JDCAGNET.md',
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'CONTRIBUTING.md',
  'package.json',
  'pnpm-workspace.yaml',
  'turbo.json',
]

export function buildRepoWikiEvidencePacket(input: RepoWikiEvidenceInput): RepoWikiEvidenceBundle {
  const now = input.now ?? Date.now
  const createdAt = now()
  const packets: RepoWikiEvidencePacket[] = []
  const diagnostics: ContextDiagnostic[] = []
  const repoMap = buildRepoMap(input.indexStore)
  const repoMapContent = renderRepoMap(repoMap)
  const indexedHashes = new Map(input.indexStore.allFiles().map((file) => [file.filePath, file.hash]))

  if (repoMap.files.length > 0) {
    packets.push({
      id: packetId('repo_map', 'code-index'),
      ref: 'code-index',
      title: 'Code index repository map',
      content: trimPacket(repoMapContent, input.maxPacketChars),
      hash: hashContent(repoMapContent),
      relatedSymbols: unique(repoMap.symbols.map((symbol) => symbol.name)),
    })
  }

  for (const file of repoMap.files) {
    const content = [
      `${file.path} (${file.role}, ${file.language})`,
      ...file.topSymbols.map((symbol) => `${symbol.kind} ${symbol.name}:${symbol.line}${symbol.signature ? ` ${symbol.signature}` : ''}`),
    ].join('\n')

    const current = readCurrentFileHash(input.cwd, file.path, indexedHashes.get(file.path), createdAt)
    if (current.diagnostic) diagnostics.push(current.diagnostic)
    if (!current.hash) continue

    packets.push({
      id: packetId('file', file.path),
      ref: file.path,
      title: `${file.role}: ${file.path}`,
      content: trimPacket(content, input.maxPacketChars),
      hash: current.hash,
      relatedSymbols: unique(file.topSymbols.map((symbol) => symbol.name)),
    })
  }

  const docCandidates = typeof input.maxDocs === 'number' ? DOC_CANDIDATES.slice(0, Math.max(0, input.maxDocs)) : DOC_CANDIDATES
  for (const ref of docCandidates) {
    const absolute = path.join(input.cwd, ref)
    if (!existsSync(absolute)) continue
    const content = readFileSync(absolute, 'utf-8')
    packets.push({
      id: packetId('doc', ref),
      ref,
      title: `Repository document: ${ref}`,
      content: trimPacket(docContent(ref, content), input.maxPacketChars),
      hash: hashContent(content),
      relatedSymbols: [],
    })
  }

  const evidenceHash = hashContent(JSON.stringify(packets.map(({ id, ref, hash, content }) => ({ id, ref, hash, content }))))
  return { packets, evidenceHash, createdAt, diagnostics }
}

function docContent(ref: string, content: string): string {
  if (path.basename(ref) !== 'package.json') return content
  try {
    const parsed = JSON.parse(content) as { scripts?: Record<string, unknown>; workspaces?: unknown; packageManager?: unknown; name?: unknown }
    return JSON.stringify({
      name: parsed.name,
      packageManager: parsed.packageManager,
      workspaces: parsed.workspaces,
      scripts: parsed.scripts ?? {},
    })
  } catch {
    return content
  }
}

function readCurrentFileHash(cwd: string, filePath: string, indexedHash: string | undefined, createdAt: number): { hash?: string; diagnostic?: ContextDiagnostic } {
  const absolute = path.join(cwd, filePath)
  try {
    const content = readFileSync(absolute, 'utf-8')
    const currentIndexHash = hashIndexedFileContent(content)
    const currentCitationHash = hashCurrentFileContent(content)
    if (indexedHash && indexedHash !== currentIndexHash) {
      return {
        diagnostic: repoWikiEvidenceDiagnostic('warning', `Repo Wiki evidence skipped stale index packet for ${filePath}: indexed hash does not match current file hash`, createdAt),
      }
    }
    return { hash: currentCitationHash }
  } catch (error) {
    return {
      diagnostic: repoWikiEvidenceDiagnostic('warning', `Repo Wiki evidence skipped unreadable indexed file ${filePath}: ${error instanceof Error ? error.message : String(error)}`, createdAt),
    }
  }
}

function repoWikiEvidenceDiagnostic(level: ContextDiagnostic['level'], message: string, createdAt: number): ContextDiagnostic {
  return {
    id: `diag_repo_wiki_evidence_${createHash('sha1').update(`${message}:${createdAt}`).digest('hex').slice(0, 16)}`,
    level,
    source: 'RepoWikiEvidence',
    message,
    createdAt,
    visibleInPrimaryUi: true,
  }
}

function trimPacket(content: string, maxChars?: number): string {
  return typeof maxChars === 'number' && content.length > maxChars ? content.slice(0, maxChars) : content
}

function packetId(kind: string, ref: string): string {
  return `wiki_packet_${createHash('sha1').update(`${kind}:${ref}`).digest('hex').slice(0, 16)}`
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
