import { build } from 'esbuild'

const watch = process.argv.includes('--watch')

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
}

if (watch) {
  const ctx = await (await import('esbuild')).context(options)
  await ctx.watch()
  console.log('Watching...')
} else {
  await build(options)
}
