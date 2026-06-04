import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assembleSystemPrompt, joinSegments } from './context.js'
import { getContextEnginePromptSegment } from './context-engine/prompt.js'
import { compactMessages, MIN_COMPACT_LENGTH } from './compact.js'
import type { Message, ModelConfig, StreamChunk } from './types.js'
import type { ModelProvider } from './model-provider.js'

const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
  tmpDirs.length = 0
})

describe('legacy file-based memory retirement', () => {
  it('does not inject file-based MEMORY.md instructions into the system prompt', async () => {
    const cwd = makeTempDir()

    const prompt = joinSegments(await assembleSystemPrompt({ cwd, toolDefs: [], toolNames: [] }))

    expect(prompt).not.toContain('persistent, file-based memory system')
    expect(prompt).not.toContain('How to save memories')
    expect(prompt).not.toContain('Current memory index (MEMORY.md)')
  })

  it('compacts conversation history without requesting legacy memory extraction tags', async () => {
    let compactPrompt = ''
    const provider: ModelProvider = {
      name: 'compact-test-provider',
      chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
      stream: async function* (_messages: Message[], _tools, config: ModelConfig): AsyncGenerator<StreamChunk> {
        compactPrompt = typeof config.systemPrompt === 'string'
          ? config.systemPrompt
          : config.systemPrompt?.map((segment) => segment.content).join('\n') ?? ''
        yield { type: 'text_delta', text: '<summary>Compacted only.</summary>' }
        yield { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } }
      },
    }

    const result = await compactMessages(makeMessages(), provider, { model: 'test-model', maxTokens: 1024 })

    expect(result.status).toBe('compacted')
    expect(compactPrompt).not.toContain('<memories>')
    expect(compactPrompt).not.toContain('extract any persistent memories')
    expect(compactPrompt).not.toContain('JSON array of memories to save')
  })

  it('instructs compaction not to resurrect completed, cancelled, or superseded work', async () => {
    let compactPrompt = ''
    const provider: ModelProvider = {
      name: 'compact-stale-task-guard-provider',
      chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
      stream: async function* (_messages: Message[], _tools, config: ModelConfig): AsyncGenerator<StreamChunk> {
        compactPrompt = typeof config.systemPrompt === 'string'
          ? config.systemPrompt
          : config.systemPrompt?.map((segment) => segment.content).join('\n') ?? ''
        yield { type: 'text_delta', text: '<summary>No stale tasks.</summary>' }
        yield { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } }
      },
    }

    const result = await compactMessages(makeMessages(), provider, { model: 'test-model', maxTokens: 1024 })

    expect(result.status).toBe('compacted')
    expect(compactPrompt).toContain('Do not resurrect completed, cancelled, rejected, or superseded tasks')
    expect(compactPrompt).toContain('Pending Work must contain only work that is still explicitly requested and incomplete')
    expect(compactPrompt).toContain('Immediate Next Step may be "None"')
    expect(compactPrompt).toContain('The continuing assistant must verify durable state before acting')
  })

  it('describes JDC project memory and forbids legacy SaveMemory in the context engine prompt', () => {
    const prompt = getContextEnginePromptSegment().segment
    expect(prompt).toContain('JdcMemoryWrite')
    expect(prompt).toContain('JdcMemorySearch')
    expect(prompt).toContain('项目级')
    expect(prompt).toContain('citation')
    expect(prompt).toContain('自动注入的 `<jdc-context-engine>`')
    expect(prompt).toContain('不要重复调用 `JdcMemorySearch`')
    expect(prompt).toContain('上下文缺失、模糊或需要验证')
    expect(prompt).toContain('同一项目跨会话共享')
    expect(prompt).toContain('不同项目之间不共享')
    expect(prompt).not.toContain('JdcContextInspect')
    expect(prompt).not.toContain('JdcContextRefresh')
    expect(prompt).not.toContain('诊断观察')
    expect(prompt).not.toContain('SaveMemory')
  })
})

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'jdc-legacy-memory-retirement-'))
  tmpDirs.push(dir)
  return dir
}

function makeMessages(): Message[] {
  return Array.from({ length: MIN_COMPACT_LENGTH }, (_, index) => ({
    id: `msg_${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: [{ type: 'text', text: `message ${index}` }],
    timestamp: index,
  })) as Message[]
}
