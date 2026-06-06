import type { IndexStore } from './graph/store.js'
import { tokenizeQueryText } from './query-tokenizer.js'
import type { FileIndex, SymbolNode } from './types.js'

export type RepoMapFileRole = 'entrypoint' | 'source' | 'test' | 'config' | 'doc'

export interface RepoMapFileSymbol {
  name: string
  kind: string
  line: number
  signature?: string
}

export interface RepoMapFile {
  path: string
  language: string
  role: RepoMapFileRole
  symbolCount: number
  topSymbols: RepoMapFileSymbol[]
}

export interface RepoMapLanguageGroup {
  language: string
  fileCount: number
  symbolCount: number
  files: string[]
}

export interface RepoMapSymbol {
  name: string
  kind: string
  file: string
  line: number
  signature?: string
}

export interface RepoMapImportEdge {
  from: string
  to: string
  localName: string
}

export interface RepoMap {
  totalFiles: number
  totalSymbols: number
  files: RepoMapFile[]
  languages: RepoMapLanguageGroup[]
  symbols: RepoMapSymbol[]
  importEdges: RepoMapImportEdge[]
}

export interface RepoMapOptions {
  objective?: string
  pathPrefix?: string
  maxFiles?: number
  maxSymbols?: number
  maxImportEdges?: number
  maxTopSymbolsPerFile?: number
}

const EMPTY_REPO_MAP: RepoMap = {
  totalFiles: 0,
  totalSymbols: 0,
  files: [],
  languages: [],
  symbols: [],
  importEdges: [],
}

export function buildRepoMap(store: Pick<IndexStore, 'allFiles'>, options: RepoMapOptions = {}): RepoMap {
  let indexedFiles: FileIndex[]
  try {
    indexedFiles = store.allFiles()
  } catch {
    return { ...EMPTY_REPO_MAP, files: [], languages: [], symbols: [], importEdges: [] }
  }

  const pathPrefix = normalizePathPrefix(options.pathPrefix)
  const queryTokens = tokenizeQueryText(options.objective ?? '').map((token) => token.value.toLowerCase())
  const candidateFiles = indexedFiles
    .filter((file) => !pathPrefix || file.filePath.startsWith(pathPrefix))
    .map((file) => ({ file, score: scoreFile(file, queryTokens) }))
    .sort((a, b) => b.score - a.score || a.file.filePath.localeCompare(b.file.filePath))

  const selectedFiles = typeof options.maxFiles === 'number'
    ? candidateFiles.slice(0, Math.max(0, options.maxFiles))
    : candidateFiles
  const selectedFilePaths = new Set(selectedFiles.map((item) => item.file.filePath))
  const selectedFileIndexes = selectedFiles.map((item) => item.file)
  const symbols = selectedFileIndexes
    .flatMap((file) => sortedSymbols(file.symbols).map((symbol) => toRepoMapSymbol(symbol)))
  const importEdges = selectedFileIndexes
    .flatMap((file) => file.imports.map((binding) => ({
      from: file.filePath,
      to: binding.source,
      localName: binding.localName,
    })))
    .sort((a, b) => a.from.localeCompare(b.from) || a.localName.localeCompare(b.localName) || a.to.localeCompare(b.to))

  return {
    totalFiles: selectedFiles.length,
    totalSymbols: selectedFileIndexes.reduce((total, file) => total + file.symbols.length, 0),
    files: selectedFiles.map((item) => ({
      path: item.file.filePath,
      language: item.file.language,
      role: classifyFileRole(item.file.filePath),
      symbolCount: item.file.symbols.length,
      topSymbols: topSymbolsForFile(item.file, options.maxTopSymbolsPerFile),
    })),
    languages: languageGroups(indexedFiles.filter((file) => selectedFilePaths.has(file.filePath))),
    symbols: typeof options.maxSymbols === 'number' ? symbols.slice(0, Math.max(0, options.maxSymbols)) : symbols,
    importEdges: typeof options.maxImportEdges === 'number' ? importEdges.slice(0, Math.max(0, options.maxImportEdges)) : importEdges,
  }
}

export function renderRepoMap(map: RepoMap): string {
  if (map.files.length === 0) return 'No indexed repository files are available.'

  const parts: string[] = []
  if (map.languages.length) {
    parts.push('Languages:\n' + map.languages.map((group) => `- ${group.language}: ${group.fileCount} files, ${group.symbolCount} symbols (${group.files.join(', ')})`).join('\n'))
  }
  if (map.files.length) {
    parts.push('Files:\n' + map.files.map((file) => {
      const topSymbols = file.topSymbols.length
        ? ` Top symbols: ${file.topSymbols.map((symbol) => `${symbol.kind} ${symbol.name}:${symbol.line}`).join('; ')}`
        : ''
      return `- ${file.path} (${file.role}, ${file.language}, ${file.symbolCount} symbols)${topSymbols}`
    }).join('\n'))
  }
  if (map.symbols.length) {
    parts.push('Symbols:\n' + map.symbols.map((symbol) => `- ${symbol.kind} ${symbol.name} — ${symbol.file}:${symbol.line}${symbol.signature ? ` ${symbol.signature}` : ''}`).join('\n'))
  }
  if (map.importEdges.length) {
    parts.push('Imports:\n' + map.importEdges.map((edge) => `- ${edge.from} imports ${edge.localName} from ${edge.to}`).join('\n'))
  }
  return parts.join('\n\n')
}

function topSymbolsForFile(file: FileIndex, maxTopSymbolsPerFile: number | undefined): RepoMapFileSymbol[] {
  const symbols = sortedSymbols(file.symbols).map((symbol) => ({
    name: symbol.name,
    kind: symbol.kind,
    line: symbol.line,
    signature: symbol.signature,
  }))
  return typeof maxTopSymbolsPerFile === 'number' ? symbols.slice(0, Math.max(0, maxTopSymbolsPerFile)) : symbols
}

function toRepoMapSymbol(symbol: SymbolNode): RepoMapSymbol {
  return {
    name: symbol.name,
    kind: symbol.kind,
    file: symbol.filePath,
    line: symbol.line,
    signature: symbol.signature,
  }
}

function sortedSymbols(symbols: SymbolNode[]): SymbolNode[] {
  return [...symbols].sort((a, b) => symbolKindRank(a.kind) - symbolKindRank(b.kind) || a.line - b.line || a.name.localeCompare(b.name))
}

function languageGroups(files: FileIndex[]): RepoMapLanguageGroup[] {
  const groups = new Map<string, RepoMapLanguageGroup>()
  for (const file of [...files].sort((a, b) => a.filePath.localeCompare(b.filePath))) {
    const existing = groups.get(file.language)
    if (existing) {
      existing.fileCount += 1
      existing.symbolCount += file.symbols.length
      existing.files.push(file.filePath)
    } else {
      groups.set(file.language, {
        language: file.language,
        fileCount: 1,
        symbolCount: file.symbols.length,
        files: [file.filePath],
      })
    }
  }
  return [...groups.values()].sort((a, b) => a.language.localeCompare(b.language))
}

export function classifyFileRole(filePath: string): RepoMapFileRole {
  const lower = filePath.toLowerCase()
  const base = lower.split('/').pop() ?? lower
  if (/^(readme|agents|jdcagnet|contributing|changelog|design|plan)(\.[a-z0-9]+)?$/.test(base)) return 'doc'
  if (/^(package|tsconfig|jsconfig|vite|vitest|eslint|prettier|rollup|webpack|next|tailwind|postcss)(\.|-|$)/.test(base)) return 'config'
  if (/(^|\/)(__tests__|tests?)\//.test(lower) || /(^|[._-])(test|spec)\.[^.]+$/.test(base)) return 'test'
  if (/^(main|index|app|server|cli)\.[^.]+$/.test(base)) return 'entrypoint'
  return 'source'
}

function scoreFile(file: FileIndex, queryTokens: string[]): number {
  const lowerPath = file.filePath.toLowerCase()
  let score = roleScore(classifyFileRole(file.filePath))
  for (const token of queryTokens) {
    if (lowerPath.includes(token)) score += 30
    if (file.symbols.some((symbol) => symbol.name.toLowerCase().includes(token) || symbol.signature?.toLowerCase().includes(token))) score += 25
    if (file.imports.some((binding) => binding.localName.toLowerCase().includes(token) || binding.source.toLowerCase().includes(token))) score += 15
  }
  return score
}

function roleScore(role: RepoMapFileRole): number {
  if (role === 'entrypoint') return 50
  if (role === 'source') return 20
  if (role === 'config') return 10
  if (role === 'doc') return 8
  return -40
}

function symbolKindRank(kind: string): number {
  if (kind === 'function' || kind === 'method') return 1
  if (kind === 'class' || kind === 'interface' || kind === 'struct') return 2
  if (kind === 'type' || kind === 'enum') return 3
  if (kind === 'constant' || kind === 'variable') return 4
  return 5
}

function normalizePathPrefix(pathPrefix: string | undefined): string {
  return pathPrefix?.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '') ?? ''
}
