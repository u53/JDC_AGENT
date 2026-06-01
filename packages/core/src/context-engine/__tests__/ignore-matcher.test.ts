import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createIgnoreMatcher } from '../indexer/scanner.js'

describe('context-engine: shared ignore matcher (scan + watcher)', () => {
  it('matches built-in dirs and .gitignore entries the watcher must skip', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'jdc-ignore-'))
    try {
      writeFileSync(path.join(dir, '.gitignore'), ['docs/', 'generated/', '*.gen.ts', ''].join('\n'))
      const isIgnored = createIgnoreMatcher(dir)

      // built-in ignores
      expect(isIgnored('node_modules/foo/index.js')).toBe(true)
      expect(isIgnored('dist/bundle.js')).toBe(true)

      // .gitignore'd generated paths — the exact watcher bug being fixed
      expect(isIgnored('docs/readme.ts')).toBe(true)
      expect(isIgnored('generated/api.ts')).toBe(true)
      expect(isIgnored('src/schema.gen.ts')).toBe(true)

      // real source must NOT be ignored
      expect(isIgnored('src/index.ts')).toBe(false)
      expect(isIgnored('packages/core/src/engine.ts')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
