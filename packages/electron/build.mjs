import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFileSync, existsSync } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '../..')

// Main process — CJS (required for preload to work correctly in Electron 33)
await build({
  entryPoints: [path.join(__dirname, 'src/main.ts')],
  bundle: true,
  platform: 'node',
  outdir: path.join(__dirname, 'dist'),
  external: ['electron'],
  format: 'cjs',
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
