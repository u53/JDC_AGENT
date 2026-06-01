// Extracts a FileIndex (symbols + references + imports) from one source file
// using Tree-sitter tag queries.

import { createHash } from 'node:crypto'
import { Query, type Node } from 'web-tree-sitter'
import type { FileIndex, SymbolNode, ReferenceNode, ImportBinding, SymbolKind } from '../types.js'
import { createParser } from './ts-loader.js'
import { tagsQueryFor, DEFINITION_KIND } from './tags.js'

// Compiled queries are cached per language. A query that fails to compile (a
// node name absent from that grammar) is recorded as `null` so we skip it
// instead of throwing on every file and aborting the whole index build.
const compiledQueries = new Map<string, Query | null>()

function getCompiledQuery(languageId: string, lang: import('web-tree-sitter').Language): Query | null {
  if (compiledQueries.has(languageId)) return compiledQueries.get(languageId)!
  const source = tagsQueryFor(languageId)
  if (!source) {
    compiledQueries.set(languageId, null)
    return null
  }
  try {
    const q = new Query(lang, source)
    compiledQueries.set(languageId, q)
    return q
  } catch (err) {
    console.error(`[context-engine] tags query for "${languageId}" failed to compile, skipping:`, (err as Error).message)
    compiledQueries.set(languageId, null)
    return null
  }
}

// When two patterns capture the SAME name node (e.g. a Python function_definition
// matched as both generic `function` and class-nested `method`), the higher rank
// wins so labels stay semantically precise.
const KIND_SPECIFICITY: Record<SymbolKind, number> = {
  variable: 0,
  type: 0,
  function: 1,
  module: 2,
  constant: 2,
  class: 3,
  struct: 3,
  enum: 3,
  interface: 3,
  method: 4,
}

export function hashContent(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

function symbolId(filePath: string, name: string, startLine: number): string {
  return `${filePath}#${name}@${startLine}`
}

/** Find the nearest ancestor that represents a definition body, for ranges. */
function enclosingDefNode(node: Node): Node {
  let cur: Node | null = node
  while (cur) {
    const t = cur.type
    if (
      t.endsWith('_declaration') ||
      t.endsWith('_definition') ||
      t.endsWith('_item') ||
      t === 'method_definition' ||
      t === 'class' ||
      t === 'module' ||
      t === 'method'
    ) {
      return cur
    }
    cur = cur.parent
  }
  return node
}

/**
 * Parse source into a FileIndex. Returns null if the language has no parser.
 * `filePath` must be the project-relative POSIX path.
 */
export async function parseFile(
  filePath: string,
  languageId: string,
  content: string,
): Promise<FileIndex | null> {
  const parser = await createParser(languageId)
  if (!parser) return null

  try {
    const tree = parser.parse(content)
    if (!tree) return null
    const lang = parser.language!
    const query = getCompiledQuery(languageId, lang)
    if (!query) return null
    const captures = query.captures(tree.rootNode)

    const symbols: SymbolNode[] = []
    const references: ReferenceNode[] = []
    const imports: ImportBinding[] = []

    // First pass: collect symbol definitions so we can attribute references.
    // Overlapping patterns can capture the same name node under different kinds
    // (generic vs specific); dedup by node position and keep the most specific.
    const symbolByNode = new Map<string, { sym: SymbolNode; rank: number }>()
    for (const cap of captures) {
      const [group, kindSuffix] = cap.name.split('.')
      const node = cap.node
      if (group === 'definition') {
        const kind = (DEFINITION_KIND[kindSuffix] ?? 'variable') as SymbolKind
        const def = enclosingDefNode(node)
        const startLine = def.startPosition.row + 1
        const endLine = def.endPosition.row + 1
        const name = node.text
        const nodeKey = `${node.startIndex}:${node.endIndex}`
        const rank = KIND_SPECIFICITY[kind] ?? 0
        const existing = symbolByNode.get(nodeKey)
        if (existing && existing.rank >= rank) continue
        symbolByNode.set(nodeKey, {
          rank,
          sym: {
            id: symbolId(filePath, name, startLine),
            name,
            kind,
            filePath,
            line: node.startPosition.row + 1,
            column: node.startPosition.column + 1,
            startLine,
            endLine,
            signature: firstLine(content, def.startPosition.row),
          },
        })
      } else if (group === 'import') {
        if (kindSuffix === 'source') {
          imports.push({
            localName: '',
            source: stripQuotes(node.text),
            filePath,
            line: node.startPosition.row + 1,
          })
        } else if (kindSuffix === 'name') {
          imports.push({
            localName: node.text,
            source: '',
            filePath,
            line: node.startPosition.row + 1,
          })
        }
      }
    }
    for (const { sym } of symbolByNode.values()) symbols.push(sym)

    // Second pass: references, attributed to their enclosing defined symbol.
    for (const cap of captures) {
      const [group, kindSuffix] = cap.name.split('.')
      if (group !== 'reference') continue
      const node = cap.node
      const refLine = node.startPosition.row + 1
      const enclosing = findEnclosingSymbol(symbols, refLine)
      references.push({
        name: node.text,
        filePath,
        line: refLine,
        column: node.startPosition.column + 1,
        kind: kindSuffix === 'call' ? 'call' : 'usage',
        enclosingSymbolId: enclosing?.id,
      })
    }

    return {
      filePath,
      language: languageId,
      hash: hashContent(content),
      symbols,
      references,
      imports,
    }
  } finally {
    parser.delete()
  }
}

/** Smallest symbol whose [startLine,endLine] contains the given line. */
function findEnclosingSymbol(symbols: SymbolNode[], line: number): SymbolNode | undefined {
  let best: SymbolNode | undefined
  let bestSpan = Infinity
  for (const s of symbols) {
    if (line >= s.startLine && line <= s.endLine) {
      const span = s.endLine - s.startLine
      if (span < bestSpan) {
        best = s
        bestSpan = span
      }
    }
  }
  return best
}

function firstLine(content: string, row: number): string {
  const lines = content.split('\n')
  return (lines[row] ?? '').trim().slice(0, 200)
}

function stripQuotes(s: string): string {
  return s.replace(/^['"`]|['"`]$/g, '')
}
