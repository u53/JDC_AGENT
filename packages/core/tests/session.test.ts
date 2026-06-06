import { describe, it, expect, afterAll } from 'vitest'
import { ConversationHistory } from '../src/history.js'
import { Session } from '../src/session.js'
import type { ModelProvider } from '../src/model-provider.js'
import type { SessionEvents, Message, StreamChunk } from '../src/index.js'
import path from 'node:path'
import os from 'node:os'
import { platform } from 'node:process'
import { mkdir, rm, writeFile } from 'node:fs/promises'

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

describe('Session background shell verification ledger', () => {
  it('records background shell completion in the active tool runner runtime', async () => {
    const cwd = path.join(os.tmpdir(), `jdcagnet-bg-ledger-${Date.now()}`)
    const dbPath = path.join(os.tmpdir(), `jdcagnet-bg-ledger-${Date.now()}.db`)
    await mkdir(cwd, { recursive: true })
    const history = new ConversationHistory(dbPath)
    await history.ensureReady()
    history.createSession('bg-ledger-session', 'BgLedgerProject', cwd)
    const session = new Session(
      {
        id: 'bg-ledger-session',
        projectName: 'BgLedgerProject',
        cwd,
        modelConfig: { model: 'test-model', maxTokens: 1024 },
      },
      providerFromText('ok'),
      history,
    )
    await session.ensureHooksReady()
    const internals = session as unknown as {
      toolRunner: import('../src/tool-runner.js').ToolRunner
      backgroundTasks: import('../src/background-tasks.js').BackgroundTaskManager
    }
    const targetPath = path.join(cwd, 'src/a.ts')
    internals.toolRunner.constraintRuntime.postToolUse({
      toolName: 'Edit',
      toolUseId: 'edit_1',
      input: { file_path: targetPath },
      cwd,
      fileReadState: internals.toolRunner.fileReadState,
      result: {
        content: 'Successfully edited',
        metadata: { mutations: [{ filePath: targetPath, kind: 'edit' }] },
      },
    })

    try {
      const notification = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('background task did not complete')), 5000)
        session.onNotificationReady = () => {
          clearTimeout(timeout)
          resolve()
        }
      })
      const fakeBin = path.join(cwd, 'bin')
      await mkdir(fakeBin, { recursive: true })
      const fakePnpm = path.join(fakeBin, platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
      await writeFile(
        fakePnpm,
        platform === 'win32' ? '@echo off\r\necho build ok\r\n' : '#!/bin/sh\necho build ok\n',
        { mode: 0o755 },
      )
      internals.backgroundTasks.spawn('pnpm build', cwd, { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}` }, 'bash')
      await notification

      expect(internals.toolRunner.constraintRuntime.verificationLedger.getChangedFiles()).toEqual([
        expect.objectContaining({
          filePath: targetPath,
          status: 'verified',
          changedByToolUseId: 'edit_1',
        }),
      ])
    } finally {
      history.close()
      await rm(cwd, { recursive: true, force: true })
      await rm(dbPath, { force: true })
    }
  })
})
