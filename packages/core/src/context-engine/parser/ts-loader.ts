// Tree-sitter WASM loader. Initializes the web-tree-sitter runtime once and
// lazily loads + caches grammar languages on demand.
//
// WASM resolution strategy:
//  - Runtime wasm (`tree-sitter.wasm`) and grammar wasms normally live in
//    node_modules. In a packaged Electron app they are copied next to the
//    bundle, so we honor JDC_TREE_SITTER_WASM_DIR (runtime) and
//    JDC_GRAMMAR_WASM_DIR (grammars) as overrides.

import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { Parser, Language } from 'web-tree-sitter'
import { specForLanguage } from './languages.js'

let initPromise: Promise<void> | null = null
const languageCache = new Map<string, Language>()
const languageLoading = new Map<string, Promise<Language | null>>()

/**
 * Resolve a package file path defensively across execution contexts:
 *  - real ESM (tests via tsx/vitest): createRequire(import.meta.url)
 *  - esbuild CJS bundle (electron): the ambient `require` is available
 * We avoid calling createRequire(import.meta.url) at module top-level because
 * esbuild rewrites import.meta.url to `undefined` in the CJS bundle.
 */
function resolvePackageFile(request: string): string | null {
  // 1. Ambient CJS require (present in esbuild bundle and plain CJS).
  const ambient = (globalThis as { require?: NodeRequire }).require
  if (typeof ambient?.resolve === 'function') {
    try {
      return ambient.resolve(request)
    } catch {
      /* fall through */
    }
  }
  // 2. Real ESM with a usable import.meta.url.
  try {
    const url = (import.meta as { url?: string }).url
    if (typeof url === 'string' && url.length > 0) {
      return createRequire(url).resolve(request)
    }
  } catch {
    /* fall through */
  }
  return null
}

/** Directory holding web-tree-sitter's runtime `tree-sitter.wasm`. */
function runtimeWasmDir(): string | null {
  const override = process.env.JDC_TREE_SITTER_WASM_DIR
  if (override && existsSync(path.join(override, 'tree-sitter.wasm'))) return override
  const entry = resolvePackageFile('web-tree-sitter')
  return entry ? path.dirname(entry) : null
}

/** Directory holding grammar wasms (tree-sitter-*.wasm). */
function grammarWasmDir(): string | null {
  const override = process.env.JDC_GRAMMAR_WASM_DIR
  if (override && existsSync(override)) return override
  const pkg = resolvePackageFile('tree-sitter-wasms/package.json')
  return pkg ? path.join(path.dirname(pkg), 'out') : null
}

/** Initialize the Tree-sitter runtime exactly once. */
export async function ensureParserInit(): Promise<void> {
  if (!initPromise) {
    const dir = runtimeWasmDir()
    // Emscripten accepts a partial module options object at runtime; the typings
    // mark every field required, so widen via unknown. If we found the runtime
    // dir, point locateFile at it; otherwise let the runtime use its default.
    const opts = (
      dir ? { locateFile: (name: string) => path.join(dir, name) } : {}
    ) as unknown as Parameters<typeof Parser.init>[0]
    initPromise = Parser.init(opts).catch((err) => {
      initPromise = null
      throw err
    })
  }
  return initPromise
}

/** Load (and cache) a grammar Language by language id. Returns null if absent. */
export async function loadLanguage(languageId: string): Promise<Language | null> {
  const cached = languageCache.get(languageId)
  if (cached) return cached
  const inflight = languageLoading.get(languageId)
  if (inflight) return inflight

  const spec = specForLanguage(languageId)
  if (!spec) return null

  const load = (async (): Promise<Language | null> => {
    await ensureParserInit()
    const dir = grammarWasmDir()
    if (!dir) return null
    const wasmPath = path.join(dir, spec.wasm)
    if (!existsSync(wasmPath)) return null
    const bytes = await readFile(wasmPath)
    const lang = await Language.load(bytes)
    languageCache.set(languageId, lang)
    return lang
  })().finally(() => languageLoading.delete(languageId))

  languageLoading.set(languageId, load)
  return load
}

/** Create a fresh parser bound to the given language. Caller owns delete(). */
export async function createParser(languageId: string): Promise<Parser | null> {
  const lang = await loadLanguage(languageId)
  if (!lang) return null
  const parser = new Parser()
  parser.setLanguage(lang)
  return parser
}

/** Test hook: drop all cached state so tests can re-init cleanly. */
export function _resetLoaderForTests(): void {
  initPromise = null
  languageCache.clear()
  languageLoading.clear()
}
