import { describe, expect, it, vi } from 'vitest'
import { IndexStore } from './graph/store.js'
import { buildRepoMap, renderRepoMap } from './repo-map.js'
import type { FileIndex, SymbolKind, SymbolNode } from './types.js'

function symbol(filePath: string, name: string, kind: SymbolKind, line: number, signature?: string): SymbolNode {
  return {
    id: `${filePath}#${name}@${line}`,
    name,
    kind,
    filePath,
    line,
    column: 1,
    startLine: line,
    endLine: line + 2,
    signature,
  }
}

function file(index: Partial<FileIndex> & Pick<FileIndex, 'filePath' | 'language'>): FileIndex {
  return {
    hash: index.filePath,
    symbols: [],
    references: [],
    imports: [],
    ...index,
  }
}

describe('buildRepoMap', () => {
  it('summarizes indexed files with language groups, symbol counts, and representative symbols', () => {
    const store = new IndexStore()
    store.upsertFile(file({
      filePath: 'src/main.ts',
      language: 'typescript',
      symbols: [
        symbol('src/main.ts', 'main', 'function', 1, 'export function main()'),
        symbol('src/main.ts', 'AppShell', 'class', 5, 'export class AppShell'),
      ],
      imports: [{ localName: 'authenticate', source: './auth', filePath: 'src/main.ts', line: 1 }],
    }))
    store.upsertFile(file({
      filePath: 'src/auth.ts',
      language: 'typescript',
      symbols: [symbol('src/auth.ts', 'authenticate', 'function', 3, 'export function authenticate()')],
    }))
    store.upsertFile(file({
      filePath: 'src/main.test.ts',
      language: 'typescript',
      symbols: [symbol('src/main.test.ts', 'main test', 'function', 1)],
    }))

    const map = buildRepoMap(store, { objective: 'main authenticate', maxFiles: 10, maxSymbols: 10 })

    expect(map.totalFiles).toBe(3)
    expect(map.totalSymbols).toBe(4)
    expect(map.languages).toEqual([
      { language: 'typescript', fileCount: 3, symbolCount: 4, files: ['src/auth.ts', 'src/main.test.ts', 'src/main.ts'] },
    ])
    expect(map.files).toEqual([
      expect.objectContaining({
        path: 'src/main.ts',
        language: 'typescript',
        role: 'entrypoint',
        symbolCount: 2,
        topSymbols: [
          { name: 'main', kind: 'function', line: 1, signature: 'export function main()' },
          { name: 'AppShell', kind: 'class', line: 5, signature: 'export class AppShell' },
        ],
      }),
      expect.objectContaining({ path: 'src/auth.ts', role: 'source', symbolCount: 1 }),
      expect.objectContaining({ path: 'src/main.test.ts', role: 'test', symbolCount: 1 }),
    ])
    expect(map.symbols).toContainEqual({ name: 'authenticate', kind: 'function', file: 'src/auth.ts', line: 3, signature: 'export function authenticate()' })
    expect(map.importEdges).toContainEqual({ from: 'src/main.ts', to: './auth', localName: 'authenticate' })
  })

  it('returns an empty safe map when index data is empty or unavailable', () => {
    expect(buildRepoMap(new IndexStore())).toEqual({
      totalFiles: 0,
      totalSymbols: 0,
      files: [],
      languages: [],
      symbols: [],
      importEdges: [],
    })

    const unavailableStore = { allFiles: vi.fn(() => { throw new Error('index unavailable') }) }

    expect(buildRepoMap(unavailableStore as never)).toEqual({
      totalFiles: 0,
      totalSymbols: 0,
      files: [],
      languages: [],
      symbols: [],
      importEdges: [],
    })
    expect(unavailableStore.allFiles).toHaveBeenCalledTimes(1)
  })

  it('applies explicit compact limits to selected files, symbols, import edges, and top symbols', () => {
    const store = new IndexStore()
    for (const [filePath, symbolName] of [
      ['src/alpha.ts', 'alpha'],
      ['src/beta.ts', 'beta'],
      ['src/gamma.ts', 'gamma'],
    ] as const) {
      store.upsertFile(file({
        filePath,
        language: 'typescript',
        symbols: [
          symbol(filePath, symbolName, 'function', 1, `export function ${symbolName}()`),
          symbol(filePath, `${symbolName}Helper`, 'function', 2, `export function ${symbolName}Helper()`),
        ],
        imports: [{ localName: `${symbolName}Dep`, source: './dep', filePath, line: 1 }],
      }))
    }

    const map = buildRepoMap(store, {
      objective: 'beta',
      maxFiles: 2,
      maxSymbols: 1,
      maxImportEdges: 1,
      maxTopSymbolsPerFile: 1,
    })

    expect(map.files).toHaveLength(2)
    expect(map.files[0]?.path).toBe('src/beta.ts')
    expect(map.symbols).toHaveLength(1)
    expect(map.importEdges).toHaveLength(1)
    expect(map.files.every((entry) => entry.topSymbols.length <= 1)).toBe(true)
  })

  it('renders deterministic file, language, symbol, and import sections', () => {
    const store = new IndexStore()
    store.upsertFile(file({
      filePath: 'src/main.ts',
      language: 'typescript',
      symbols: [symbol('src/main.ts', 'main', 'function', 1)],
      imports: [{ localName: 'helper', source: './helper', filePath: 'src/main.ts', line: 1 }],
    }))

    const rendered = renderRepoMap(buildRepoMap(store))

    expect(rendered).toContain('Languages:\n- typescript: 1 files, 1 symbols')
    expect(rendered).toContain('Files:\n- src/main.ts (entrypoint, typescript, 1 symbols) Top symbols: function main:1')
    expect(rendered).toContain('Symbols:\n- function main — src/main.ts:1')
    expect(rendered).toContain('Imports:\n- src/main.ts imports helper from ./helper')
  })
})
