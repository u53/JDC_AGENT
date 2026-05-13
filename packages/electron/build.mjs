import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFileSync, existsSync } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '../..')

// Main process — ESM
await build({
  entryPoints: [path.join(__dirname, 'src/main.ts')],
  bundle: true,
  platform: 'node',
  outdir: path.join(__dirname, 'dist'),
  external: ['electron'],
  format: 'esm',
  alias: {
    '@jdcagnet/core': path.join(rootDir, 'packages/core/src/index.ts'),
  },
  banner: {
    js: `import { createRequire as _cr } from 'module'; const require = _cr('file://${rootDir.replace(/\\/g, '/')}/package.json'); import { fileURLToPath } from 'url'; const __filename = fileURLToPath(import.meta.url); import { dirname } from 'path'; const __dirname = dirname(__filename);`,
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
})

// Copy sql-wasm.wasm to dist
const wasmSrc = path.join(rootDir, 'node_modules/.pnpm/sql.js@1.14.1/node_modules/sql.js/dist/sql-wasm.wasm')
const wasmDst = path.join(__dirname, 'dist/sql-wasm.wasm')
if (existsSync(wasmSrc)) {
  copyFileSync(wasmSrc, wasmDst)
} else {
  // Fallback: search for it
  const { execSync } = await import('node:child_process')
  const found = execSync(`find ${rootDir}/node_modules -name "sql-wasm.wasm" -print -quit`, { encoding: 'utf-8' }).trim()
  if (found) copyFileSync(found, wasmDst)
}
