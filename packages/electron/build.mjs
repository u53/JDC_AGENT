import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { copyFileSync, existsSync, cpSync, mkdirSync } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '../..')
const require = createRequire(import.meta.url)

/**
 * Resolve a package file via Node module resolution. Cross-platform and safe
 * with paths containing spaces — never shells out. Returns null if unresolved.
 */
function resolvePkgFile(request) {
  try {
    return require.resolve(request)
  } catch {
    return null
  }
}

// Main process — CJS (required for preload to work correctly in Electron 33)
await build({
  entryPoints: [path.join(__dirname, 'src/main.ts')],
  bundle: true,
  platform: 'node',
  outdir: path.join(__dirname, 'dist'),
  // web-tree-sitter / tree-sitter-wasms stay external: web-tree-sitter's ESM
  // build uses import.meta.url to locate its own wasm, which breaks once
  // inlined into a CJS bundle. Keeping it external makes Node require() the
  // CJS entry, which resolves wasm correctly at runtime.
  external: ['electron', 'node-pty', 'sharp', 'web-tree-sitter', 'tree-sitter-wasms'],
  format: 'cjs',
  minify: true,
  keepNames: true,
  alias: {
    '@jdcagnet/core': path.join(rootDir, 'packages/core/src/index.ts'),
  },
})

// Preload — must be CJS for Electron sandbox
await build({
  entryPoints: [path.join(__dirname, 'src/preload.ts')],
  bundle: true,
  platform: 'node',
  outdir: path.join(__dirname, 'dist'),
  external: ['electron'],
  format: 'cjs',
  minify: true,
  keepNames: true,
})

// Copy sql-wasm.wasm to dist
const wasmSrc = path.join(rootDir, 'node_modules/.pnpm/sql.js@1.14.1/node_modules/sql.js/dist/sql-wasm.wasm')
const wasmDst = path.join(__dirname, 'dist/sql-wasm.wasm')
if (existsSync(wasmSrc)) {
  copyFileSync(wasmSrc, wasmDst)
} else {
  // Resolve via Node module resolution (cross-platform, space-safe). sql.js is a
  // dependency of @jdcagnet/core, so resolve from there rather than electron.
  const corePkg = resolvePkgFile('@jdcagnet/core/package.json')
  const fromCore = corePkg
    ? createRequire(corePkg).resolve('sql.js/package.json')
    : null
  const found = fromCore ? path.join(path.dirname(fromCore), 'dist/sql-wasm.wasm') : null
  if (found && existsSync(found)) copyFileSync(found, wasmDst)
  else console.warn('[build] sql-wasm.wasm not found via module resolution')
}

// Copy UI dist to packages/electron/ui/ for production loadFile path
const uiSrc = path.join(rootDir, 'packages/ui/dist')
const uiDst = path.join(__dirname, 'ui')
if (existsSync(uiSrc)) {
  mkdirSync(uiDst, { recursive: true })
  cpSync(uiSrc, uiDst, { recursive: true })
}

// Copy Tree-sitter wasm assets for the JDC Context Engine.
// Runtime: web-tree-sitter/tree-sitter.wasm → dist/tree-sitter/
// Grammars: tree-sitter-wasms/out/*.wasm   → dist/tree-sitter/grammars/
// Resolved via Node module resolution — no shelling out, works on Windows and
// with paths containing spaces.
const tsDir = path.join(__dirname, 'dist/tree-sitter')
const grammarDir = path.join(tsDir, 'grammars')
mkdirSync(grammarDir, { recursive: true })

const wtsEntry = resolvePkgFile('web-tree-sitter')
const runtimeWasm = wtsEntry ? path.join(path.dirname(wtsEntry), 'tree-sitter.wasm') : null
if (runtimeWasm && existsSync(runtimeWasm)) {
  copyFileSync(runtimeWasm, path.join(tsDir, 'tree-sitter.wasm'))
} else {
  console.warn('[build] web-tree-sitter runtime wasm not found:', runtimeWasm)
}

const grammarsPkg = resolvePkgFile('tree-sitter-wasms/package.json')
const grammarsOut = grammarsPkg ? path.join(path.dirname(grammarsPkg), 'out') : null
if (grammarsOut && existsSync(grammarsOut)) {
  cpSync(grammarsOut, grammarDir, { recursive: true })
} else {
  console.warn('[build] tree-sitter-wasms grammars not found:', grammarsOut)
}
