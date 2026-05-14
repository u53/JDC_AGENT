import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseMemories, saveMemories } from '../src/memory-extractor.js'
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('parseMemories', () => {
  it('should parse memories from model output', () => {
    const output = `Here is the summary...
<memories>[{"name":"no-native-dialogs","type":"feedback","description":"Never use native dialogs","content":"Always use Radix UI components instead of native confirm/alert."}]</memories>`

    const memories = parseMemories(output)
    expect(memories).toHaveLength(1)
    expect(memories[0].name).toBe('no-native-dialogs')
    expect(memories[0].type).toBe('feedback')
    expect(memories[0].content).toContain('Radix UI')
  })

  it('should return empty array when no memories tag', () => {
    expect(parseMemories('just a summary')).toEqual([])
  })

  it('should return empty array for empty memories', () => {
    expect(parseMemories('<memories>[]</memories>')).toEqual([])
  })

  it('should handle malformed JSON gracefully', () => {
    expect(parseMemories('<memories>not json</memories>')).toEqual([])
  })

  it('should filter out incomplete memory objects', () => {
    const output = '<memories>[{"name":"valid","type":"feedback","description":"desc","content":"ok"},{"name":"missing-content","type":"feedback"}]</memories>'
    const memories = parseMemories(output)
    expect(memories).toHaveLength(1)
    expect(memories[0].name).toBe('valid')
  })
})

describe('saveMemories', () => {
  const tmpDir = path.join(os.tmpdir(), 'jdcagnet-mem-test-' + Date.now())

  beforeEach(() => mkdirSync(tmpDir, { recursive: true }))
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }))

  it('should write memory files and update index', async () => {
    const memories = [
      { name: 'test-pref', type: 'feedback', description: 'Test preference', content: 'Always use TypeScript' },
    ]

    const count = await saveMemories(memories, tmpDir, 'session-123')
    expect(count).toBe(1)

    const filePath = path.join(tmpDir, 'test-pref.md')
    expect(existsSync(filePath)).toBe(true)
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('name: test-pref')
    expect(content).toContain('type: feedback')
    expect(content).toContain('Always use TypeScript')

    const index = readFileSync(path.join(tmpDir, 'MEMORY.md'), 'utf-8')
    expect(index).toContain('test-pref')
  })

  it('should skip existing memory files', async () => {
    const existing = path.join(tmpDir, 'existing.md')
    writeFileSync(existing, 'old content')

    const memories = [
      { name: 'existing', type: 'feedback', description: 'Exists', content: 'new content' },
    ]

    const count = await saveMemories(memories, tmpDir, 'session-123')
    expect(count).toBe(0)
    expect(readFileSync(existing, 'utf-8')).toBe('old content')
  })

  it('should return 0 for empty memories array', async () => {
    const count = await saveMemories([], tmpDir, 'session-123')
    expect(count).toBe(0)
  })
})
