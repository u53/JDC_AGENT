import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Session, type SessionEvents } from '../src/session.js'
import { ConversationHistory } from '../src/history.js'
import type { ModelProvider } from '../src/model-provider.js'
import type { ContentBlock, Message, ModelConfig, StreamChunk, ToolDefinition } from '../src/types.js'

class InterleavedResponsesProvider implements ModelProvider {
  name = 'openai-responses'
  calls = 0

  async chat(): Promise<{ content: ContentBlock[]; usage: { inputTokens: number; outputTokens: number } }> {
    return { content: [], usage: { inputTokens: 0, outputTokens: 0 } }
  }

  async *stream(
    _messages: Message[],
    _tools: ToolDefinition[],
    _config: ModelConfig,
    _signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    this.calls++

    if (this.calls === 1) {
      yield { type: 'text_delta', text: '我会加入 `.j' }
      yield { type: 'tool_use_start', toolUse: { id: 'call_1', name: 'Glob', input: '' } }
      yield { type: 'tool_use_delta', toolUse: { id: '', name: '', input: '{"pattern":"missing-*"}' } }
      yield { type: 'tool_use_end' }
      yield { type: 'text_delta', text: 'dcagnet/`。' }
    } else {
      yield { type: 'text_delta', text: '完成。' }
    }

    yield {
      type: 'message_end',
      usage: { inputTokens: 1, outputTokens: 1 },
    }
  }
}

class SlowTailResponsesProvider implements ModelProvider {
  name = 'openai-responses'
  calls = 0

  async chat(): Promise<{ content: ContentBlock[]; usage: { inputTokens: number; outputTokens: number } }> {
    return { content: [], usage: { inputTokens: 0, outputTokens: 0 } }
  }

  async *stream(): AsyncIterable<StreamChunk> {
    this.calls++

    if (this.calls === 1) {
      yield { type: 'text_delta', text: '先看一下。' }
      yield { type: 'tool_use_start', toolUse: { id: 'call_read', name: 'Read', input: '' } }
      yield { type: 'tool_use_delta', toolUse: { id: '', name: '', input: '{"file_path":"a.ts"}' } }
      yield { type: 'tool_use_end' }
      await new Promise(resolve => setTimeout(resolve, 20))
      yield { type: 'text_delta', text: '我还在补充说明。' }
    } else {
      yield { type: 'text_delta', text: '读取完成。' }
    }

    yield { type: 'message_end', usage: { inputTokens: 1, outputTokens: 1 } }
  }
}

describe('Session response block ordering', () => {
  it('keeps interleaved OpenAI Responses text together before tool cards', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'jdcagnet-reorder-'))
    const dbPath = path.join(cwd, 'history.db')
    const history = new ConversationHistory(dbPath)
    await history.ensureReady()

    const provider = new InterleavedResponsesProvider()
    const session = new Session(
      {
        id: 'session-response-reorder',
        projectName: 'TestProject',
        cwd,
        modelConfig: {
          model: 'test-model',
          maxTokens: 1024,
          contextWindow: 100000,
        },
      },
      provider,
      history,
      async () => true
    )

    const completed: Message[] = []
    const events: SessionEvents = {
      onStreamChunk: vi.fn(),
      onToolEvent: vi.fn(),
      onMessageComplete: (message) => completed.push(message),
      onError: (error) => {
        throw error
      },
    }

    try {
      await session.sendMessage('test', events)

      const firstAssistant = completed.find((message) => message.role === 'assistant')
      expect(firstAssistant?.content).toEqual([
        { type: 'text', text: '我会加入 `.jdcagnet/`。' },
        { type: 'tool_use', id: 'call_1', name: 'Glob', input: { pattern: 'missing-*' } },
      ])
    } finally {
      history.close()
      await fs.rm(cwd, { recursive: true, force: true })
    }
  })

  it('starts read-only tools as soon as the tool call completes even while Responses tail text is still streaming', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'jdcagnet-eager-tool-'))
    const dbPath = path.join(cwd, 'history.db')
    const history = new ConversationHistory(dbPath)
    await history.ensureReady()

    const provider = new SlowTailResponsesProvider()
    const session = new Session(
      {
        id: 'session-eager-tool',
        projectName: 'TestProject',
        cwd,
        modelConfig: {
          model: 'test-model',
          maxTokens: 1024,
          contextWindow: 100000,
        },
      },
      provider,
      history,
      async () => true
    )
    session.registerTool({
      definition: {
        name: 'Read',
        description: 'Read test file',
        inputSchema: { type: 'object', properties: { file_path: { type: 'string' } } },
      },
      async execute() {
        return { content: 'file result' }
      },
    })

    const order: string[] = []
    const events: SessionEvents = {
      onStreamChunk: (chunk) => {
        if (chunk.type === 'text_delta' && chunk.text === '我还在补充说明。') order.push('tail_text')
      },
      onToolEvent: (event) => {
        if (event.type === 'start' && event.toolUseId === 'call_read') order.push('tool_start')
      },
      onMessageComplete: () => undefined,
      onError: (error) => {
        throw error
      },
    }

    try {
      await session.sendMessage('test', events)

      expect(order).toEqual(['tool_start', 'tail_text'])
    } finally {
      history.close()
      await fs.rm(cwd, { recursive: true, force: true })
    }
  })
})
