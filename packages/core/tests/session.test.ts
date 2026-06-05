import { describe, it, expect, afterAll } from 'vitest'
import { ConversationHistory } from '../src/history.js'
import { Session } from '../src/session.js'
import type { ModelProvider } from '../src/model-provider.js'
import type { SessionEvents, Message, StreamChunk } from '../src/index.js'
import path from 'node:path'
import os from 'node:os'

function providerFromText(text: string): ModelProvider {
  return {
    name: 'retry-test-provider',
    async chat() {
      return { content: [{ type: 'text', text }], usage: { inputTokens: 1, outputTokens: 1 } }
    },
    async *stream(): AsyncIterable<StreamChunk> {
      yield { type: 'text_delta', text }
      yield { type: 'message_end', usage: { inputTokens: 1, outputTokens: 1 } }
    },
  }
}

function silentEvents(): SessionEvents {
  return {
    onStreamChunk: () => {},
    onToolEvent: () => {},
    onMessageComplete: () => {},
    onError: () => {},
  }
}

describe('ConversationHistory', () => {
  const dbPath = path.join(os.tmpdir(), `jdcagnet-test-${Date.now()}.db`)
  let history: ConversationHistory

  it('should create and list sessions', async () => {
    history = new ConversationHistory(dbPath)
    // DB init is async (sql.js); wait for it before synchronous operations.
    await history.ensureReady()
    history.createSession('s1', 'TestProject', '/tmp/test')
    history.createSession('s2', 'OtherProject', '/tmp/other')

    const all = history.listSessions()
    expect(all).toHaveLength(2)

    const filtered = history.listSessions('/tmp/test')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].projectName).toBe('TestProject')
  })

  it('should store and retrieve messages', () => {
    history.addMessage('s1', { id: 'm1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: Date.now() })
    history.addMessage('s1', { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'hi' }], timestamp: Date.now() })

    const messages = history.getMessages('s1')
    expect(messages).toHaveLength(2)
    expect(messages[0].content[0]).toEqual({ type: 'text', text: 'hello' })
    expect(messages[1].role).toBe('assistant')
  })

  it('should delete session and its messages', () => {
    history.deleteSession('s1')
    expect(history.getMessages('s1')).toHaveLength(0)
    expect(history.listSessions('/tmp/test')).toHaveLength(0)
  })

  it('should update session title', () => {
    history.updateSessionTitle('s2', 'My Chat')
    const sessions = history.listSessions()
    expect(sessions[0].title).toBe('My Chat')
  })

  afterAll(() => {
    history.close()
  })
})

describe('Session retry', () => {
  it('retries the current turn without appending a duplicate user message', async () => {
    const dbPath = path.join(os.tmpdir(), `jdcagnet-retry-test-${Date.now()}.db`)
    const retryHistory = new ConversationHistory(dbPath)
    await retryHistory.ensureReady()
    retryHistory.createSession('retry-session', 'RetryProject', '/tmp/retry')
    const completed: Message[] = []
    const events = {
      ...silentEvents(),
      onMessageComplete: (message: Message) => completed.push(message),
    }
    const session = new Session(
      {
        id: 'retry-session',
        projectName: 'RetryProject',
        cwd: '/tmp/retry',
        modelConfig: { model: 'test-model', maxTokens: 1024 },
      },
      providerFromText('ok'),
      retryHistory,
    )

    await session.sendMessage('hello', events)
    await session.retryLastTurn(events)

    const stored = retryHistory.getMessages('retry-session')
    expect(stored.filter(message => message.role === 'user')).toHaveLength(1)
    expect(stored.filter(message => message.role === 'assistant')).toHaveLength(2)
    expect(completed).toHaveLength(2)
    retryHistory.close()
  })
})
