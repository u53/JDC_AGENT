import { describe, it, expect, afterAll } from 'vitest'
import { ConversationHistory } from '../src/history.js'
import path from 'node:path'
import os from 'node:os'

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
