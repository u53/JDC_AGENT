import { build } from 'esbuild'

await build({
  entryPoints: ['src/main.ts', 'src/preload.ts'],
  bundle: true,
  platform: 'node',
  outdir: 'dist',
  external: ['electron', 'better-sqlite3'],
  format: 'esm',
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url); import { fileURLToPath } from 'url'; const __filename = fileURLToPath(import.meta.url); import { dirname } from 'path'; const __dirname = dirname(__filename);",
  },
})
