import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  afterEach(async () => {
    vi.useRealTimers()
    history.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('updates an existing external conversation mapping', () => {
    history.createSession('session_1', 'Project', '/repo/project')
    history.createSession('session_2', 'Project', '/repo/other')

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
    const updated = history.upsertExternalConversation({
      channel: 'feishu',
      bindingId: 'binding_1',
      tenantKey: 'tenant_1',
      chatId: 'chat_1',
      threadKey: 'thread_1',
      userKey: 'user_1',
      cwd: '/repo/other',
      sessionId: 'session_2',
    })

    expect(updated.id).toBe(first.id)
    expect(updated.sessionId).toBe('session_2')
    expect(updated.cwd).toBe('/repo/other')
    expect(updated.state).toBe('active')
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

  it('allows failed external events to be retried once', () => {
    const first = history.beginExternalEvent({
      channel: 'feishu',
      eventId: 'event_failed',
      messageId: 'message_1',
      bindingId: 'binding_1',
    })
    history.completeExternalEvent('feishu', 'event_failed', 'failed')

    const retry = history.beginExternalEvent({
      channel: 'feishu',
      eventId: 'event_failed',
      messageId: 'message_1',
      bindingId: 'binding_1',
    })
    const duplicateRetry = history.beginExternalEvent({
      channel: 'feishu',
      eventId: 'event_failed',
      messageId: 'message_1',
      bindingId: 'binding_1',
    })

    expect(first.status).toBe('accepted')
    expect(retry.status).toBe('accepted')
    expect(duplicateRetry.status).toBe('duplicate')
  })

  it('allows stale in-flight external events to be retried', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-24T00:00:00.000Z'))

    const first = history.beginExternalEvent({
      channel: 'feishu',
      eventId: 'event_stale',
      messageId: 'message_1',
      bindingId: 'binding_1',
    })

    vi.setSystemTime(new Date('2026-06-24T00:11:00.000Z'))

    const retry = history.beginExternalEvent({
      channel: 'feishu',
      eventId: 'event_stale',
      messageId: 'message_1',
      bindingId: 'binding_1',
    })
    const duplicateRetry = history.beginExternalEvent({
      channel: 'feishu',
      eventId: 'event_stale',
      messageId: 'message_1',
      bindingId: 'binding_1',
    })

    expect(first.status).toBe('accepted')
    expect(retry.status).toBe('accepted')
    expect(duplicateRetry.status).toBe('duplicate')
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

  it('marks sessions with external Feishu mappings in session lists', () => {
    history.createSession('session_1', 'Project', '/repo/project')
    history.upsertExternalConversation({
      channel: 'feishu',
      bindingId: 'binding_1',
      chatId: 'chat_1',
      threadKey: 'thread_1',
      cwd: '/repo/project',
      sessionId: 'session_1',
    })

    expect(history.listSessions('/repo/project')).toEqual([
      expect.objectContaining({
        id: 'session_1',
        externalChannel: 'feishu',
      }),
    ])
  })

  it('persists a session permission mode for external sessions', () => {
    history.createSession('session_1', 'Project', '/repo/project', { permissionMode: 'relaxed' })

    expect(history.getSessionPermissionMode('session_1')).toBe('relaxed')
    expect(history.listSessions('/repo/project')).toEqual([
      expect.objectContaining({
        id: 'session_1',
        permissionMode: 'relaxed',
      }),
    ])
  })
})
