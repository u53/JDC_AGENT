import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ConversationHistory } from '../src/history.js'

describe('external conversation persistence', () => {
  let dir: string
  let history: ConversationHistory

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdc-external-conv-'))
    history = new ConversationHistory(path.join(dir, 'history.db'))
    await history.ensureReady()
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('creates and reuses an external conversation mapping', () => {
    history.createSession('session_1', 'Project', '/repo/project')
    const first = history.upsertExternalConversation({
      channel: 'feishu',
      bindingId: 'binding_1',
      tenantKey: 'tenant_1',
      chatId: 'chat_1',
      threadKey: 'thread_1',
      userKey: 'user_1',
      cwd: '/repo/project',
      sessionId: 'session_1',
    })
    const second = history.findExternalConversation({
      channel: 'feishu',
      bindingId: 'binding_1',
      tenantKey: 'tenant_1',
      chatId: 'chat_1',
      threadKey: 'thread_1',
      userKey: 'user_1',
    })

    expect(first.sessionId).toBe('session_1')
    expect(second?.id).toBe(first.id)
    expect(second?.cwd).toBe('/repo/project')
  })

  it('dedupes external events before model invocation', () => {
    const first = history.beginExternalEvent({
      channel: 'feishu',
      eventId: 'event_1',
      messageId: 'message_1',
      bindingId: 'binding_1',
    })
    const duplicate = history.beginExternalEvent({
      channel: 'feishu',
      eventId: 'event_1',
      messageId: 'message_1',
      bindingId: 'binding_1',
    })

    expect(first.status).toBe('accepted')
    expect(duplicate.status).toBe('duplicate')
  })

  it('stores external message correlation without duplicating transcript content', () => {
    history.createSession('session_1', 'Project', '/repo/project')
    history.addExternalMessageMapping({
      channel: 'feishu',
      bindingId: 'binding_1',
      sessionId: 'session_1',
      feishuMessageId: 'message_1',
      jdcMessageId: 'jdc_msg_1',
      replyMessageId: 'reply_1',
    })

    const mappings = history.listExternalMessageMappings('feishu', 'session_1')
    expect(mappings).toEqual([
      expect.objectContaining({
        feishuMessageId: 'message_1',
        jdcMessageId: 'jdc_msg_1',
        replyMessageId: 'reply_1',
      }),
    ])
    expect(history.getMessages('session_1')).toEqual([])
  })
})
