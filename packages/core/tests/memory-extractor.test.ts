import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseMemories, saveMemories } from '../src/memory-extractor.js'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('parseMemories', () => {
  it('ignores legacy memory extraction tags after file-based memory retirement', () => {
    const output = `Here is the summary...
<memories>[{"name":"no-native-dialogs","type":"feedback","description":"Never use native dialogs","content":"Always use Radix UI components instead of native confirm/alert."}]</memories>`

    expect(parseMemories(output)).toEqual([])
  })

  it('returns empty array when no memories tag', () => {
    expect(parseMemories('just a summary')).toEqual([])
  })

  it('returns empty array for empty memories', () => {
    expect(parseMemories('<memories>[]</memories>')).toEqual([])
  })

  it('handles malformed legacy JSON as retired no-op', () => {
    expect(parseMemories('<memories>not json</memories>')).toEqual([])
  })
})

describe('saveMemories', () => {
  const tmpDir = path.join(os.tmpdir(), 'jdcagnet-mem-test-' + Date.now())

  beforeEach(() => mkdirSync(tmpDir, { recursive: true }))
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }))

  it('does not write legacy memory files or MEMORY.md indexes', async () => {
    const memories = [
      { name: 'test-pref', type: 'feedback', description: 'Test preference', content: 'Always use TypeScript' },
    ]

    const count = await saveMemories(memories, tmpDir, 'session-123')

    expect(count).toBe(0)
    expect(existsSync(path.join(tmpDir, 'test-pref.md'))).toBe(false)
    expect(existsSync(path.join(tmpDir, 'MEMORY.md'))).toBe(false)
  })

  it('returns 0 for empty memories array', async () => {
    const count = await saveMemories([], tmpDir, 'session-123')
    expect(count).toBe(0)
  })
})
