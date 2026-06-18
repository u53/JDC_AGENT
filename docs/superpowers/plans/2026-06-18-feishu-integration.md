# Feishu Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Feishu bot access to JDCAGNET so multiple self-built Feishu bots can be added, each bot binding to one project `cwd`, while all messages run through the existing JDC session runtime, tools, context injection, and compaction.

**Architecture:** Implement Feishu as an Electron main-process client transport, not as a second agent runtime. Add generic external conversation persistence in core history, extract session event sinks in Electron, then add Feishu binding/config, conversation resolution, sink formatting, long-connection bridge, permission interaction routing, and a minimal settings UI for multiple bot bindings.

**Tech Stack:** TypeScript, Electron main process, React, Zustand, Vitest, sql.js history store, existing `Session`/`SessionManager`, Feishu official Node SDK `@larksuiteoapi/node-sdk`.

---

## Scope Check

This plan implements the first Feishu version described in `docs/superpowers/specs/2026-06-18-feishu-integration-design.md`.

Included:

- Multiple Feishu bot bindings.
- One bot binding maps to exactly one project `cwd`.
- Long-connection Feishu receive path while Electron app is running.
- Text-message receive and text reply.
- Existing JDC session runtime reuse.
- Existing compaction and context injection reuse.
- Tool progress and completion summaries.
- Permission, ask-user, and plan-review routing through Feishu for Feishu-originated runs.
- Minimal settings UI for adding, editing, deleting, enabling, and disabling bot bindings.

Deferred from first implementation:

- Image/file message ingestion from Feishu.
- Rich file upload for very long replies.
- Public HTTP callback endpoint.
- One Feishu bot routing to multiple projects.
- Server-side headless gateway.

## File Structure

- Modify: `packages/core/src/history.ts`
  - Add generic external conversation, event dedupe, and message mapping tables plus typed methods.
- Create: `packages/core/tests/external-conversations.test.ts`
  - Covers mapping persistence, dedupe, and message correlation.
- Create: `packages/electron/src/session-event-sink.ts`
  - Defines `SessionEventSink`, `SessionInteractionSink`, `createSessionEvents()`, `createUiSink()`, and sink multiplexing helpers.
- Create: `packages/electron/src/session-event-sink.test.ts`
  - Covers UI forwarding and multiplexing.
- Modify: `packages/electron/src/session-manager.ts`
  - Reuse `SessionEventSink` for UI and Feishu, expose Feishu-safe session methods, and route permission/ask/plan interactions.
- Create: `packages/electron/src/feishu/types.ts`
  - Feishu binding, inbound event, outbound client, command, and runtime state types.
- Create: `packages/electron/src/feishu/binding-store.ts`
  - Loads and saves multiple Feishu bot bindings through existing app config.
- Create: `packages/electron/src/feishu/binding-store.test.ts`
  - Covers multiple binding CRUD and default values.
- Create: `packages/electron/src/feishu/conversation-resolver.ts`
  - Resolves Feishu chat/thread/user into JDC sessions.
- Create: `packages/electron/src/feishu/conversation-resolver.test.ts`
  - Covers group chat, single chat, thread fallback, `/new`, `/status`, `/stop`, `/compact`, and authorization.
- Create: `packages/electron/src/feishu/feishu-sink.ts`
  - Converts session events and interaction prompts into Feishu messages/cards.
- Create: `packages/electron/src/feishu/feishu-sink.test.ts`
  - Covers chunk buffering, long message splitting, tool summaries, compact events, permission prompts, and final status.
- Create: `packages/electron/src/feishu/client.ts`
  - Wraps the Feishu official SDK behind a testable client interface.
- Create: `packages/electron/src/feishu/bridge.ts`
  - Owns lifecycle, long-connection event registration, dedupe, binding resolution, conversation resolution, and session dispatch.
- Create: `packages/electron/src/feishu/bridge.test.ts`
  - Uses fake Feishu client and fake session manager facade to prove inbound events create/use sessions and reply once.
- Modify: `packages/electron/src/main.ts`
  - Start/stop Feishu bridge with the Electron app.
- Modify: `packages/electron/src/ipc-channels.ts`
  - Add Feishu settings/status IPC channel constants.
- Modify: `packages/electron/src/ipc-handlers.ts`
  - Add binding CRUD, bridge restart, and status handlers.
- Modify: `packages/electron/src/preload.ts`
  - Expose Feishu settings/status APIs.
- Modify: `packages/ui/src/lib/ipc-client.ts`
  - Add typed Feishu IPC client methods.
- Modify: `packages/ui/src/stores/settings-store.ts`
  - Add `feishu` settings tab.
- Modify: `packages/ui/src/components/SettingsOverlay.tsx`
  - Add Feishu tab for multiple bot bindings.
- Modify: `packages/ui/src/components/SettingsOverlay.test.tsx`
  - Cover Feishu settings tab and multiple bindings.
- Modify: `packages/electron/package.json`
  - Add Feishu SDK dependency.
- Modify: `pnpm-lock.yaml`
  - Lock Feishu SDK dependency.

---

## Task 1: Generic External Conversation Persistence

**Files:**
- Modify: `packages/core/src/history.ts`
- Create: `packages/core/tests/external-conversations.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Create `packages/core/tests/external-conversations.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run tests/external-conversations.test.ts --no-file-parallelism
```

Expected: FAIL with missing `upsertExternalConversation`, `findExternalConversation`, `beginExternalEvent`, `addExternalMessageMapping`, and `listExternalMessageMappings`.

- [ ] **Step 3: Add external tables and methods**

Modify `packages/core/src/history.ts`:

```ts
export interface ExternalConversationInput {
  channel: string
  bindingId: string
  tenantKey?: string
  chatId: string
  threadKey: string
  userKey?: string
  cwd: string
  sessionId: string
}

export interface ExternalConversationRecord extends ExternalConversationInput {
  id: string
  state: 'active' | 'archived'
  createdAt: number
  updatedAt: number
}

export interface ExternalConversationLookup {
  channel: string
  bindingId: string
  tenantKey?: string
  chatId: string
  threadKey: string
  userKey?: string
}

export interface ExternalEventInput {
  channel: string
  eventId: string
  messageId?: string
  bindingId: string
}

export interface ExternalMessageMappingInput {
  channel: string
  bindingId: string
  sessionId: string
  feishuMessageId: string
  jdcMessageId?: string
  replyMessageId?: string
}
```

Add three tables in `migrate()`:

```sql
CREATE TABLE IF NOT EXISTS external_conversations (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  tenant_key TEXT,
  chat_id TEXT NOT NULL,
  thread_key TEXT NOT NULL,
  user_key TEXT,
  cwd TEXT NOT NULL,
  session_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
)
```

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_external_conversation_lookup
ON external_conversations(channel, binding_id, COALESCE(tenant_key, ''), chat_id, thread_key, COALESCE(user_key, ''))
```

```sql
CREATE TABLE IF NOT EXISTS external_events (
  channel TEXT NOT NULL,
  event_id TEXT NOT NULL,
  message_id TEXT,
  binding_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  processed_at INTEGER,
  status TEXT NOT NULL,
  PRIMARY KEY (channel, event_id)
)
```

```sql
CREATE TABLE IF NOT EXISTS external_messages (
  channel TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  feishu_message_id TEXT NOT NULL,
  jdc_message_id TEXT,
  reply_message_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (channel, feishu_message_id)
)
```

Implement these methods on `ConversationHistory`:

```ts
upsertExternalConversation(input: ExternalConversationInput): ExternalConversationRecord
findExternalConversation(input: ExternalConversationLookup): ExternalConversationRecord | null
beginExternalEvent(input: ExternalEventInput): { status: 'accepted' | 'duplicate' }
completeExternalEvent(channel: string, eventId: string, status: 'processed' | 'failed'): void
addExternalMessageMapping(input: ExternalMessageMappingInput): void
listExternalMessageMappings(channel: string, sessionId: string): Array<ExternalMessageMappingInput & { createdAt: number }>
```

Use `JSON.stringify` nowhere in these tables; store scalar routing fields so lookups remain simple.

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run tests/external-conversations.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/history.ts packages/core/tests/external-conversations.test.ts
git commit -m "feat(core): persist external conversation mappings"
```

---

## Task 2: Feishu Binding Config and IPC Surface

**Files:**
- Create: `packages/electron/src/feishu/types.ts`
- Create: `packages/electron/src/feishu/binding-store.ts`
- Create: `packages/electron/src/feishu/binding-store.test.ts`
- Modify: `packages/electron/src/ipc-channels.ts`
- Modify: `packages/electron/src/ipc-handlers.ts`
- Modify: `packages/electron/src/preload.ts`
- Modify: `packages/ui/src/lib/ipc-client.ts`

- [ ] **Step 1: Write failing binding store tests**

Create `packages/electron/src/feishu/binding-store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  config: {} as Record<string, any>,
}))

vi.mock('@jdcagnet/core', () => ({
  loadAppConfig: () => mocks.config,
  saveAppConfig: (patch: Record<string, any>) => {
    mocks.config = { ...mocks.config, ...patch }
  },
}))

describe('FeishuBindingStore', () => {
  beforeEach(() => {
    mocks.config = {}
  })

  it('adds multiple bot bindings and preserves one cwd per binding', async () => {
    const { FeishuBindingStore } = await import('./binding-store')
    const store = new FeishuBindingStore()

    const first = store.addBinding({
      name: 'HR bot',
      appId: 'cli_hr',
      appSecret: 'secret_hr',
      projectName: 'hr_demo',
      cwd: '/repo/hr_demo',
      sessionStrategy: 'thread',
      enabled: true,
    })
    const second = store.addBinding({
      name: 'Ops bot',
      appId: 'cli_ops',
      appSecret: 'secret_ops',
      projectName: 'ops',
      cwd: '/repo/ops',
      sessionStrategy: 'chat',
      enabled: false,
    })

    expect(store.listBindings().map((item: any) => [item.id, item.cwd])).toEqual([
      [first.id, '/repo/hr_demo'],
      [second.id, '/repo/ops'],
    ])
  })

  it('updates and deletes bindings by id', async () => {
    const { FeishuBindingStore } = await import('./binding-store')
    const store = new FeishuBindingStore()
    const binding = store.addBinding({
      name: 'HR bot',
      appId: 'cli_hr',
      appSecret: 'secret_hr',
      projectName: 'hr_demo',
      cwd: '/repo/hr_demo',
      sessionStrategy: 'thread',
      enabled: true,
    })

    store.updateBinding(binding.id, { enabled: false, cwd: '/repo/hr_v2', projectName: 'hr_v2' })
    expect(store.getBinding(binding.id)).toMatchObject({ enabled: false, cwd: '/repo/hr_v2' })

    store.deleteBinding(binding.id)
    expect(store.listBindings()).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter jdcagnet exec vitest run src/feishu/binding-store.test.ts --no-file-parallelism
```

Expected: FAIL because `binding-store` does not exist.

- [ ] **Step 3: Implement binding types and store**

Create `packages/electron/src/feishu/types.ts`:

```ts
export type FeishuPermissionMode = 'standard' | 'relaxed' | 'strict'
export type FeishuSessionStrategy = 'thread' | 'chat'

export interface FeishuBinding {
  id: string
  name: string
  enabled: boolean
  appId: string
  appSecret: string
  tenantKey?: string
  verificationToken?: string
  encryptKey?: string
  projectName: string
  cwd: string
  defaultModelId?: string
  permissionMode: FeishuPermissionMode
  allowedChatIds: string[]
  allowedOpenIds: string[]
  sessionStrategy: FeishuSessionStrategy
  createdAt: number
  updatedAt: number
}

export type FeishuBindingInput = Omit<FeishuBinding, 'id' | 'createdAt' | 'updatedAt' | 'permissionMode' | 'allowedChatIds' | 'allowedOpenIds'> & {
  permissionMode?: FeishuPermissionMode
  allowedChatIds?: string[]
  allowedOpenIds?: string[]
}
```

Create `packages/electron/src/feishu/binding-store.ts` with these public methods:

```ts
export class FeishuBindingStore {
  listBindings(): FeishuBinding[]
  getBinding(id: string): FeishuBinding | null
  getEnabledBindings(): FeishuBinding[]
  addBinding(input: FeishuBindingInput): FeishuBinding
  updateBinding(id: string, patch: Partial<FeishuBindingInput>): FeishuBinding
  deleteBinding(id: string): void
}
```

Persist under `config.feishu.bindings`. Normalize missing arrays to `[]`, missing `permissionMode` to `'standard'`, and missing `sessionStrategy` to `'thread'`.

- [ ] **Step 4: Add IPC channels and handlers**

Modify `packages/electron/src/ipc-channels.ts`:

```ts
FEISHU_BINDINGS_LIST: 'feishu:bindings:list',
FEISHU_BINDINGS_ADD: 'feishu:bindings:add',
FEISHU_BINDINGS_UPDATE: 'feishu:bindings:update',
FEISHU_BINDINGS_DELETE: 'feishu:bindings:delete',
FEISHU_STATUS: 'feishu:status',
FEISHU_RESTART: 'feishu:restart',
```

Modify `packages/electron/src/ipc-handlers.ts` to register handlers that call a `FeishuBindingStore` instance. Return `{ success: true }` for mutating calls and `{ bindings }` for list.

- [ ] **Step 5: Expose preload and UI IPC client methods**

Modify `packages/electron/src/preload.ts`:

```ts
feishuListBindings: () => ipcRenderer.invoke('feishu:bindings:list'),
feishuAddBinding: (binding: any) => ipcRenderer.invoke('feishu:bindings:add', binding),
feishuUpdateBinding: (id: string, patch: any) => ipcRenderer.invoke('feishu:bindings:update', { id, patch }),
feishuDeleteBinding: (id: string) => ipcRenderer.invoke('feishu:bindings:delete', { id }),
feishuStatus: () => ipcRenderer.invoke('feishu:status'),
feishuRestart: () => ipcRenderer.invoke('feishu:restart'),
```

Modify `packages/ui/src/lib/ipc-client.ts` to add matching `window.electronAPI` types and:

```ts
feishu: {
  listBindings: () => invoke('feishu:bindings:list') as Promise<{ bindings: FeishuBinding[] }>
  addBinding: (binding: FeishuBindingInput) => invoke('feishu:bindings:add', binding) as Promise<{ success: boolean; binding: FeishuBinding }>
  updateBinding: (id: string, patch: Partial<FeishuBindingInput>) => invoke('feishu:bindings:update', { id, patch }) as Promise<{ success: boolean; binding: FeishuBinding }>
  deleteBinding: (id: string) => invoke('feishu:bindings:delete', { id }) as Promise<{ success: boolean }>
  status: () => invoke('feishu:status') as Promise<{ running: boolean; bindings: Array<{ id: string; enabled: boolean; connected: boolean; lastError?: string }> }>
  restart: () => invoke('feishu:restart') as Promise<{ success: boolean }>
}
```

- [ ] **Step 6: Run focused tests and build check**

Run:

```bash
pnpm --filter jdcagnet exec vitest run src/feishu/binding-store.test.ts --no-file-parallelism
pnpm --filter jdcagnet build
```

Expected: PASS and build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/electron/src/feishu/types.ts packages/electron/src/feishu/binding-store.ts packages/electron/src/feishu/binding-store.test.ts packages/electron/src/ipc-channels.ts packages/electron/src/ipc-handlers.ts packages/electron/src/preload.ts packages/ui/src/lib/ipc-client.ts
git commit -m "feat(feishu): add bot binding config"
```

---

## Task 3: Session Event Sink Boundary

**Files:**
- Create: `packages/electron/src/session-event-sink.ts`
- Create: `packages/electron/src/session-event-sink.test.ts`
- Modify: `packages/electron/src/session-manager.ts`

- [ ] **Step 1: Write failing sink tests**

Create `packages/electron/src/session-event-sink.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { StreamChunk } from '@jdcagnet/core'
import { createSessionEvents, createSinkMultiplexer } from './session-event-sink'

describe('session event sinks', () => {
  it('adapts core SessionEvents to a sink with session id', () => {
    const sink = {
      stream: vi.fn(),
      toolEvent: vi.fn(),
      messageComplete: vi.fn(),
      messagesReplaced: vi.fn(),
      usage: vi.fn(),
      error: vi.fn(),
      finished: vi.fn(),
    }
    const events = createSessionEvents('session_1', sink)
    const chunk: StreamChunk = { type: 'text_delta', text: 'hello' }

    events.onStreamChunk(chunk)
    events.onUsage?.({ turnCount: 1, inputTokens: 2, outputTokens: 3, contextUsedPercent: 1 } as any)

    expect(sink.stream).toHaveBeenCalledWith('session_1', chunk)
    expect(sink.usage).toHaveBeenCalledWith('session_1', expect.objectContaining({ turnCount: 1 }))
  })

  it('fans out events and isolates sink failures', () => {
    const first = { stream: vi.fn(() => { throw new Error('sink failed') }) }
    const second = { stream: vi.fn() }
    const mux = createSinkMultiplexer([first as any, second as any])

    mux.stream('session_1', { type: 'text_delta', text: 'ok' })

    expect(first.stream).toHaveBeenCalled()
    expect(second.stream).toHaveBeenCalledWith('session_1', { type: 'text_delta', text: 'ok' })
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter jdcagnet exec vitest run src/session-event-sink.test.ts --no-file-parallelism
```

Expected: FAIL because `session-event-sink` does not exist.

- [ ] **Step 3: Implement sink helpers**

Create `packages/electron/src/session-event-sink.ts` with:

```ts
import type { Message, StreamChunk, ToolExecutionEvent } from '@jdcagnet/core'
import type { SessionEvents } from '@jdcagnet/core'
import type { UsageSnapshot } from '@jdcagnet/core'

export interface RetrySinkEvent {
  attempt: number
  maxRetries: number
  error: string
  delayMs: number
  category: string
}

export interface SessionEventSink {
  stream?(sessionId: string, chunk: StreamChunk): void
  toolEvent?(sessionId: string, event: ToolExecutionEvent): void
  messageComplete?(sessionId: string, message: Message): void
  messagesReplaced?(sessionId: string, messages: Message[]): void
  usage?(sessionId: string, usage: UsageSnapshot): void
  retrying?(sessionId: string, event: RetrySinkEvent): void
  error?(sessionId: string, error: Error): void
  finished?(sessionId: string): void
  agentProgress?(sessionId: string, agentToolUseId: string, event: any): void
  agentText?(sessionId: string, agentToolUseId: string, text: string): void
  agentComplete?(sessionId: string, agentToolUseId: string, result: any): void
}

export interface SessionInteractionSink {
  requestPermission?(request: { toolName: string; input: Record<string, unknown> }): Promise<boolean>
  askUser?(question: string, options?: string[], multiSelect?: boolean): Promise<string>
  reviewPlan?(planFile: string, content: string): Promise<{ approved: boolean; feedback?: string }>
}

export function createSinkMultiplexer(sinks: SessionEventSink[]): SessionEventSink {
  const call = (fn: (sink: SessionEventSink) => void) => {
    for (const sink of sinks) {
      try { fn(sink) } catch (error) { console.error('[session-sink] sink failed:', error) }
    }
  }
  return {
    stream: (sessionId, chunk) => call(s => s.stream?.(sessionId, chunk)),
    toolEvent: (sessionId, event) => call(s => s.toolEvent?.(sessionId, event)),
    messageComplete: (sessionId, message) => call(s => s.messageComplete?.(sessionId, message)),
    messagesReplaced: (sessionId, messages) => call(s => s.messagesReplaced?.(sessionId, messages)),
    usage: (sessionId, usage) => call(s => s.usage?.(sessionId, usage)),
    retrying: (sessionId, event) => call(s => s.retrying?.(sessionId, event)),
    error: (sessionId, error) => call(s => s.error?.(sessionId, error)),
    finished: (sessionId) => call(s => s.finished?.(sessionId)),
    agentProgress: (sessionId, id, event) => call(s => s.agentProgress?.(sessionId, id, event)),
    agentText: (sessionId, id, text) => call(s => s.agentText?.(sessionId, id, text)),
    agentComplete: (sessionId, id, result) => call(s => s.agentComplete?.(sessionId, id, result)),
  }
}

export function createSessionEvents(sessionId: string, sink: SessionEventSink): SessionEvents {
  return {
    onStreamChunk: (chunk) => sink.stream?.(sessionId, chunk),
    onToolEvent: (event) => sink.toolEvent?.(sessionId, event),
    onMessageComplete: (message) => sink.messageComplete?.(sessionId, message),
    onMessagesReplaced: (messages) => sink.messagesReplaced?.(sessionId, messages),
    onError: (error) => sink.error?.(sessionId, error),
    onRetrying: (attempt, error, delayMs, category, maxRetries) => sink.retrying?.(sessionId, { attempt, maxRetries, error: error.message || String(error), delayMs, category }),
    onAgentProgress: (agentToolUseId, event) => sink.agentProgress?.(sessionId, agentToolUseId, event),
    onAgentText: (agentToolUseId, text) => sink.agentText?.(sessionId, agentToolUseId, text),
    onAgentComplete: (agentToolUseId, result) => sink.agentComplete?.(sessionId, agentToolUseId, result),
    onUsage: (usage) => sink.usage?.(sessionId, usage),
  }
}
```

- [ ] **Step 4: Refactor `SessionManager` to use sinks**

Modify `packages/electron/src/session-manager.ts`:

- Add `private externalEventSinks = new Map<string, Map<string, SessionEventSink>>()`.
- Add `attachSessionSink(sessionId: string, key: string, sink: SessionEventSink): () => void`.
- Add `private createUiSink(): SessionEventSink`.
- Add `private getCombinedSink(sessionId: string, extraSink?: SessionEventSink): SessionEventSink`.
- Change `sendMessage()` signature to:

```ts
async sendMessage(
  sessionId: string,
  text: string,
  images?: { data: string; mediaType: string }[],
  options?: { sink?: SessionEventSink; interactionSink?: SessionInteractionSink }
): Promise<void>
```

- Use `createSessionEvents(sessionId, this.getCombinedSink(sessionId, options?.sink))`.
- Keep existing IPC behavior by defaulting to UI sink.
- In `onNotificationReady`, use the combined sink instead of directly sending `BrowserWindow` events.

- [ ] **Step 5: Run sink tests and electron build**

Run:

```bash
pnpm --filter jdcagnet exec vitest run src/session-event-sink.test.ts --no-file-parallelism
pnpm --filter jdcagnet build
```

Expected: PASS and build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/electron/src/session-event-sink.ts packages/electron/src/session-event-sink.test.ts packages/electron/src/session-manager.ts
git commit -m "refactor(session): add reusable event sinks"
```

---

## Task 4: Interaction Routing for Permissions, AskUser, and Plan Review

**Files:**
- Modify: `packages/electron/src/session-manager.ts`
- Create: `packages/electron/src/session-interactions.test.ts`

- [ ] **Step 1: Write failing interaction tests**

Create `packages/electron/src/session-interactions.test.ts` with a focused test around interaction sink selection. Use a small exported helper if direct `SessionManager` construction is too heavy:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createInteractionRouter } from './session-event-sink'

describe('session interaction routing', () => {
  it('prefers a Feishu interaction sink for the active external run', async () => {
    const ui = { requestPermission: vi.fn().mockResolvedValue(false) }
    const feishu = { requestPermission: vi.fn().mockResolvedValue(true) }
    const router = createInteractionRouter(ui as any)

    router.attach('session_1', 'feishu:binding_1:chat_1', feishu as any)
    const allowed = await router.requestPermission('session_1', { toolName: 'Bash', input: { command: 'pnpm test' } })

    expect(allowed).toBe(true)
    expect(feishu.requestPermission).toHaveBeenCalled()
    expect(ui.requestPermission).not.toHaveBeenCalled()
  })

  it('falls back to the UI interaction sink when no external sink is attached', async () => {
    const ui = { askUser: vi.fn().mockResolvedValue('answer from ui') }
    const router = createInteractionRouter(ui as any)

    const answer = await router.askUser('session_1', 'Continue?', ['yes', 'no'], false)

    expect(answer).toBe('answer from ui')
    expect(ui.askUser).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter jdcagnet exec vitest run src/session-interactions.test.ts --no-file-parallelism
```

Expected: FAIL because `createInteractionRouter` does not exist.

- [ ] **Step 3: Implement interaction router**

Add `createInteractionRouter()` to `packages/electron/src/session-event-sink.ts`:

```ts
export function createInteractionRouter(fallback: SessionInteractionSink) {
  const sinks = new Map<string, Map<string, SessionInteractionSink>>()
  const current = (sessionId: string) => Array.from(sinks.get(sessionId)?.values() ?? []).at(-1)
  return {
    attach(sessionId: string, key: string, sink: SessionInteractionSink) {
      const sessionSinks = sinks.get(sessionId) ?? new Map<string, SessionInteractionSink>()
      sessionSinks.set(key, sink)
      sinks.set(sessionId, sessionSinks)
      return () => {
        sessionSinks.delete(key)
        if (sessionSinks.size === 0) sinks.delete(sessionId)
      }
    },
    requestPermission(sessionId: string, request: { toolName: string; input: Record<string, unknown> }) {
      return (current(sessionId)?.requestPermission ?? fallback.requestPermission)?.(request) ?? Promise.resolve(false)
    },
    askUser(sessionId: string, question: string, options?: string[], multiSelect?: boolean) {
      return (current(sessionId)?.askUser ?? fallback.askUser)?.(question, options, multiSelect) ?? Promise.resolve('')
    },
    reviewPlan(sessionId: string, planFile: string, content: string) {
      return (current(sessionId)?.reviewPlan ?? fallback.reviewPlan)?.(planFile, content) ?? Promise.resolve({ approved: false, feedback: 'No review handler is available.' })
    },
  }
}
```

- [ ] **Step 4: Wire router into `SessionManager.activateSession()`**

Modify permission, ask-user, and plan-review callbacks so they call the interaction router with `sessionId`. The UI fallback should preserve current IPC behavior:

- Permission fallback sends `permission:request` and waits for `permission:response`.
- Ask-user fallback sends `ask_user:request` and waits for `ask_user:response`.
- Plan-review fallback sends `plan:review` and waits for `plan:respond`.

For Feishu-originated sends, `sendMessage(..., { interactionSink })` attaches the interaction sink before `session.sendMessage()` and detaches it in `finally`.

- [ ] **Step 5: Run tests and build**

Run:

```bash
pnpm --filter jdcagnet exec vitest run src/session-interactions.test.ts src/session-event-sink.test.ts --no-file-parallelism
pnpm --filter jdcagnet build
```

Expected: PASS and build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/electron/src/session-event-sink.ts packages/electron/src/session-interactions.test.ts packages/electron/src/session-manager.ts
git commit -m "feat(session): route external interaction prompts"
```

---

## Task 5: Feishu Conversation Resolver and Commands

**Files:**
- Create: `packages/electron/src/feishu/conversation-resolver.ts`
- Create: `packages/electron/src/feishu/conversation-resolver.test.ts`
- Modify: `packages/electron/src/feishu/types.ts`

- [ ] **Step 1: Write failing resolver tests**

Create `packages/electron/src/feishu/conversation-resolver.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { FeishuConversationResolver } from './conversation-resolver'
import type { FeishuBinding, FeishuInboundMessage } from './types'

const binding: FeishuBinding = {
  id: 'binding_1',
  name: 'HR bot',
  enabled: true,
  appId: 'cli_hr',
  appSecret: 'secret',
  projectName: 'hr_demo',
  cwd: '/repo/hr_demo',
  permissionMode: 'standard',
  allowedChatIds: ['chat_allowed'],
  allowedOpenIds: ['user_allowed'],
  sessionStrategy: 'thread',
  createdAt: 1,
  updatedAt: 1,
}

function inbound(text: string, patch: Partial<FeishuInboundMessage> = {}): FeishuInboundMessage {
  return {
    eventId: 'event_1',
    messageId: 'message_1',
    chatId: 'chat_allowed',
    chatType: 'group',
    senderOpenId: 'user_allowed',
    text,
    threadKey: 'thread_1',
    raw: {},
    ...patch,
  }
}

describe('FeishuConversationResolver', () => {
  it('reuses an existing mapping for the same group thread', async () => {
    const history = {
      findExternalConversation: vi.fn().mockReturnValue({ sessionId: 'session_existing' }),
      upsertExternalConversation: vi.fn(),
    }
    const sessions = {
      createSession: vi.fn(),
    }
    const resolver = new FeishuConversationResolver(history as any, sessions as any)

    const result = await resolver.resolve(binding, inbound('hello'))

    expect(result.kind).toBe('message')
    expect(result.sessionId).toBe('session_existing')
    expect(sessions.createSession).not.toHaveBeenCalled()
  })

  it('creates a new session when no mapping exists', async () => {
    const history = {
      findExternalConversation: vi.fn().mockReturnValue(null),
      upsertExternalConversation: vi.fn(),
    }
    const sessions = {
      createSession: vi.fn().mockReturnValue('session_new'),
    }
    const resolver = new FeishuConversationResolver(history as any, sessions as any)

    const result = await resolver.resolve(binding, inbound('hello'))

    expect(result.sessionId).toBe('session_new')
    expect(sessions.createSession).toHaveBeenCalledWith('hr_demo', '/repo/hr_demo')
    expect(history.upsertExternalConversation).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'feishu',
      bindingId: 'binding_1',
      chatId: 'chat_allowed',
      threadKey: 'thread_1',
      cwd: '/repo/hr_demo',
      sessionId: 'session_new',
    }))
  })

  it('rejects unauthorized chats before session creation', async () => {
    const resolver = new FeishuConversationResolver({} as any, { createSession: vi.fn() } as any)
    const result = await resolver.resolve(binding, inbound('hello', { chatId: 'chat_denied' }))

    expect(result.kind).toBe('unauthorized')
  })

  it('turns slash commands into command results', async () => {
    const resolver = new FeishuConversationResolver({ findExternalConversation: vi.fn().mockReturnValue({ sessionId: 'session_1' }) } as any, {} as any)
    const result = await resolver.resolve(binding, inbound('/status'))

    expect(result.kind).toBe('command')
    expect(result.command).toBe('status')
    expect(result.sessionId).toBe('session_1')
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter jdcagnet exec vitest run src/feishu/conversation-resolver.test.ts --no-file-parallelism
```

Expected: FAIL because `conversation-resolver` does not exist.

- [ ] **Step 3: Add inbound and resolver types**

Add to `packages/electron/src/feishu/types.ts`:

```ts
export interface FeishuInboundMessage {
  eventId: string
  messageId: string
  chatId: string
  chatType: 'group' | 'p2p'
  senderOpenId: string
  text: string
  threadKey?: string
  raw: unknown
}

export type FeishuCommand = 'new' | 'status' | 'stop' | 'compact' | 'session'

export type FeishuResolvedConversation =
  | { kind: 'message'; sessionId: string; text: string }
  | { kind: 'command'; command: FeishuCommand; sessionId?: string; text: string }
  | { kind: 'unauthorized'; reason: string }
```

- [ ] **Step 4: Implement `FeishuConversationResolver`**

Create `packages/electron/src/feishu/conversation-resolver.ts`:

- Use `allowedChatIds` and `allowedOpenIds`; empty arrays mean no restriction for that dimension.
- Use `message.threadKey || message.chatId` for thread strategy.
- Use `message.chatId` for chat strategy.
- For `/new`, always create a new session and update mapping.
- For `/status`, `/stop`, `/compact`, and `/session`, return command result with mapped session id when present.
- Never accept a project path from message text.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter jdcagnet exec vitest run src/feishu/conversation-resolver.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/electron/src/feishu/types.ts packages/electron/src/feishu/conversation-resolver.ts packages/electron/src/feishu/conversation-resolver.test.ts
git commit -m "feat(feishu): resolve conversations to sessions"
```

---

## Task 6: Feishu Sink Formatting

**Files:**
- Create: `packages/electron/src/feishu/feishu-sink.ts`
- Create: `packages/electron/src/feishu/feishu-sink.test.ts`
- Modify: `packages/electron/src/feishu/types.ts`

- [ ] **Step 1: Write failing sink tests**

Create `packages/electron/src/feishu/feishu-sink.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { FeishuSink } from './feishu-sink'

describe('FeishuSink', () => {
  it('buffers text deltas and sends a final reply', async () => {
    const client = { sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }) }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1', threadKey: 'thread_1' })

    sink.stream('session_1', { type: 'text_delta', text: 'hello' } as any)
    sink.stream('session_1', { type: 'text_delta', text: ' world' } as any)
    await sink.finished?.('session_1')

    expect(client.sendText).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'chat_1',
      text: 'hello world',
    }))
  })

  it('summarizes tool events without dumping full tool results', async () => {
    const client = { sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }) }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    sink.toolEvent?.('session_1', { type: 'start', toolName: 'Bash', input: { command: 'pnpm test' } } as any)
    sink.toolEvent?.('session_1', { type: 'complete', toolName: 'Bash', result: { content: 'x'.repeat(10_000) } } as any)
    await sink.flushStatus()

    const text = client.sendText.mock.calls.map((call: any[]) => call[0].text).join('\n')
    expect(text).toContain('Bash')
    expect(text.length).toBeLessThan(1000)
  })

  it('asks for permission through Feishu and resolves on approval', async () => {
    const client = {
      sendApproval: vi.fn().mockResolvedValue({ requestId: 'approval_1' }),
      waitForApproval: vi.fn().mockResolvedValue(true),
    }
    const sink = new FeishuSink(client as any, { chatId: 'chat_1' })

    const allowed = await sink.requestPermission?.({ toolName: 'Bash', input: { command: 'git status' } })

    expect(allowed).toBe(true)
    expect(client.sendApproval).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'Bash' }))
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter jdcagnet exec vitest run src/feishu/feishu-sink.test.ts --no-file-parallelism
```

Expected: FAIL because `feishu-sink` does not exist.

- [ ] **Step 3: Add outbound client types**

Add to `packages/electron/src/feishu/types.ts`:

```ts
export interface FeishuSendTextInput {
  chatId: string
  threadKey?: string
  text: string
}

export interface FeishuApprovalInput {
  chatId: string
  threadKey?: string
  toolName: string
  summary: string
}

export interface FeishuClientPort {
  sendText(input: FeishuSendTextInput): Promise<{ messageId: string }>
  sendApproval?(input: FeishuApprovalInput): Promise<{ requestId: string }>
  waitForApproval?(requestId: string): Promise<boolean>
  waitForReply?(input: { chatId: string; threadKey?: string; promptMessageId: string }): Promise<string>
}
```

- [ ] **Step 4: Implement `FeishuSink`**

Create `packages/electron/src/feishu/feishu-sink.ts`:

- Implement `SessionEventSink` and `SessionInteractionSink`.
- Accumulate `text_delta` chunks in memory per run.
- Send a single final text reply on `finished()`.
- Split final replies over 3500 characters into multiple `sendText()` calls.
- Convert `compact_complete`, `compact_skipped`, and `compact_failed` chunks into short status text.
- Convert tool start/complete/error into short status text.
- Truncate tool event summaries to 600 characters.
- Implement `requestPermission`, `askUser`, and `reviewPlan` through `FeishuClientPort`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter jdcagnet exec vitest run src/feishu/feishu-sink.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/electron/src/feishu/types.ts packages/electron/src/feishu/feishu-sink.ts packages/electron/src/feishu/feishu-sink.test.ts
git commit -m "feat(feishu): format session events for bot replies"
```

---

## Task 7: Feishu Client Adapter and Bridge

**Files:**
- Create: `packages/electron/src/feishu/client.ts`
- Create: `packages/electron/src/feishu/bridge.ts`
- Create: `packages/electron/src/feishu/bridge.test.ts`
- Modify: `packages/electron/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add Feishu SDK dependency**

Run:

```bash
pnpm --filter jdcagnet add @larksuiteoapi/node-sdk
```

Expected: `packages/electron/package.json` gains `@larksuiteoapi/node-sdk` and `pnpm-lock.yaml` updates.

- [ ] **Step 2: Write failing bridge tests**

Create `packages/electron/src/feishu/bridge.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { FeishuBridge } from './bridge'

describe('FeishuBridge', () => {
  it('dedupes an inbound message before sending it to a JDC session', async () => {
    const client = {
      start: vi.fn(),
      stop: vi.fn(),
      onMessage: vi.fn(),
      sendText: vi.fn().mockResolvedValue({ messageId: 'reply_1' }),
    }
    const bindings = {
      getEnabledBindings: vi.fn().mockReturnValue([{ id: 'binding_1', enabled: true, appId: 'cli', appSecret: 'secret', projectName: 'Project', cwd: '/repo/project', permissionMode: 'standard', allowedChatIds: [], allowedOpenIds: [], sessionStrategy: 'thread', createdAt: 1, updatedAt: 1 }]),
    }
    const history = {
      beginExternalEvent: vi.fn()
        .mockReturnValueOnce({ status: 'accepted' })
        .mockReturnValueOnce({ status: 'duplicate' }),
      completeExternalEvent: vi.fn(),
      findExternalConversation: vi.fn().mockReturnValue({ sessionId: 'session_1' }),
    }
    const sessions = {
      createSession: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    }
    const bridge = new FeishuBridge({ clientFactory: () => client as any, bindings: bindings as any, history: history as any, sessions: sessions as any })

    await bridge.start()
    const handler = client.onMessage.mock.calls[0][0]
    await handler({ eventId: 'event_1', messageId: 'msg_1', chatId: 'chat_1', chatType: 'group', senderOpenId: 'user_1', text: 'hello', threadKey: 'thread_1', raw: {} })
    await handler({ eventId: 'event_1', messageId: 'msg_1', chatId: 'chat_1', chatType: 'group', senderOpenId: 'user_1', text: 'hello', threadKey: 'thread_1', raw: {} })

    expect(sessions.sendMessage).toHaveBeenCalledTimes(1)
    expect(history.completeExternalEvent).toHaveBeenCalledWith('feishu', 'event_1', 'processed')
  })
})
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm --filter jdcagnet exec vitest run src/feishu/bridge.test.ts --no-file-parallelism
```

Expected: FAIL because `bridge` does not exist.

- [ ] **Step 4: Implement Feishu client adapter**

Create `packages/electron/src/feishu/client.ts`:

- Export `createFeishuClient(binding: FeishuBinding): FeishuClientPort & { start(): Promise<void>; stop(): Promise<void>; onMessage(handler: (message: FeishuInboundMessage) => Promise<void>): void }`.
- Use `@larksuiteoapi/node-sdk` `Client` for `im.message.create`.
- Use `WSClient` and `EventDispatcher` for `im.message.receive_v1`.
- Parse only text messages in this first version. Non-text messages should send a short unsupported-message reply.

The send-message API call should use:

```ts
await client.im.message.create({
  params: { receive_id_type: 'chat_id' },
  data: {
    receive_id: input.chatId,
    msg_type: 'text',
    content: JSON.stringify({ text: input.text }),
  },
})
```

- [ ] **Step 5: Implement `FeishuBridge`**

Create `packages/electron/src/feishu/bridge.ts`:

- `start()` loads all enabled bindings and starts one client per binding.
- `stop()` stops all clients.
- `restart()` calls `stop()` then `start()`.
- `getStatus()` returns connection state for UI.
- Inbound handler:
  - calls `history.beginExternalEvent()`;
  - ignores duplicates;
  - resolves conversation;
  - handles commands locally;
  - creates a `FeishuSink`;
  - attaches sink and interaction sink via `SessionManager.sendMessage(..., { sink, interactionSink })`;
  - calls `history.completeExternalEvent()`.

- [ ] **Step 6: Run bridge tests and build**

Run:

```bash
pnpm --filter jdcagnet exec vitest run src/feishu/bridge.test.ts --no-file-parallelism
pnpm --filter jdcagnet build
```

Expected: PASS and build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/electron/package.json pnpm-lock.yaml packages/electron/src/feishu/client.ts packages/electron/src/feishu/bridge.ts packages/electron/src/feishu/bridge.test.ts
git commit -m "feat(feishu): add long connection bridge"
```

---

## Task 8: Electron Lifecycle Integration

**Files:**
- Modify: `packages/electron/src/main.ts`
- Modify: `packages/electron/src/ipc-handlers.ts`
- Modify: `packages/electron/src/session-manager.ts`
- Create: `packages/electron/src/feishu/main-lifecycle.test.ts`

- [ ] **Step 1: Write lifecycle tests**

Create `packages/electron/src/feishu/main-lifecycle.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createFeishuRuntime } from './bridge'

describe('Feishu lifecycle', () => {
  it('starts after session manager readiness and stops on shutdown', async () => {
    const bridge = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) }
    const runtime = createFeishuRuntime({ bridge: bridge as any })

    await runtime.start()
    await runtime.stop()

    expect(bridge.start).toHaveBeenCalledTimes(1)
    expect(bridge.stop).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter jdcagnet exec vitest run src/feishu/main-lifecycle.test.ts --no-file-parallelism
```

Expected: FAIL until lifecycle helper exists.

- [ ] **Step 3: Wire bridge into Electron main**

Modify `packages/electron/src/main.ts`:

- Instantiate `FeishuBindingStore`.
- Instantiate `FeishuBridge` after `sessionManager.ensureReady()`.
- Start bridge after IPC handlers are registered.
- Stop bridge in `before-quit`.
- Pass bridge to `registerIpcHandlers()` through the service bag.

Modify `packages/electron/src/ipc-handlers.ts` so `feishu:restart` calls `bridge.restart()` and `feishu:status` calls `bridge.getStatus()`.

- [ ] **Step 4: Run focused lifecycle tests and build**

Run:

```bash
pnpm --filter jdcagnet exec vitest run src/feishu/main-lifecycle.test.ts --no-file-parallelism
pnpm --filter jdcagnet build
```

Expected: PASS and build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/electron/src/main.ts packages/electron/src/ipc-handlers.ts packages/electron/src/session-manager.ts packages/electron/src/feishu/main-lifecycle.test.ts
git commit -m "feat(feishu): start bridge with electron app"
```

---

## Task 9: Settings UI for Multiple Bot Bindings

**Files:**
- Modify: `packages/ui/src/stores/settings-store.ts`
- Modify: `packages/ui/src/components/SettingsOverlay.tsx`
- Modify: `packages/ui/src/components/SettingsOverlay.test.tsx`
- Modify: `packages/ui/src/lib/ipc-client.ts`

- [ ] **Step 1: Write failing UI tests**

Modify `packages/ui/src/components/SettingsOverlay.test.tsx`:

```ts
it('renders Feishu settings with multiple bot bindings', () => {
  const settingsState = { isOpen: true, activeTab: 'feishu' as const, theme: 'dark' as const, config: null }
  useSettingsStore.setState(settingsState)
  Object.assign(useSettingsStore.getInitialState(), settingsState)

  const html = renderToStaticMarkup(<SettingsOverlay />)

  expect(html).toContain('飞书')
  expect(html).toContain('添加机器人')
  expect(html).toContain('App ID')
  expect(html).toContain('项目路径')
})
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/components/SettingsOverlay.test.tsx --no-file-parallelism
```

Expected: FAIL because `SettingsTab` does not include `feishu`.

- [ ] **Step 3: Add settings tab type and nav entry**

Modify `packages/ui/src/stores/settings-store.ts`:

```ts
export type SettingsTab = 'models' | 'mcp' | 'tools' | 'shortcuts' | 'advanced' | 'image' | 'feishu'
```

Modify `SettingsOverlay.tsx` `TABS`:

```ts
{ key: 'feishu', label: '飞书' },
```

- [ ] **Step 4: Implement `FeishuTab`**

Add `FeishuTab` inside `packages/ui/src/components/SettingsOverlay.tsx`:

- Loads bindings through `ipc.feishu.listBindings()`.
- Shows one compact card per binding.
- Supports add, edit, delete, enable/disable.
- Each binding form has: name, appId, appSecret, cwd, projectName, sessionStrategy, permissionMode, allowedChatIds, allowedOpenIds.
- Uses `ipc.dialog.openFolder()` for cwd selection.
- Calls `ipc.feishu.restart()` after saving changes.

Render `FeishuTab` in the settings content:

```tsx
{activeTab === 'feishu' && <FeishuTab />}
```

- [ ] **Step 5: Run UI tests and build**

Run:

```bash
pnpm --filter @jdcagnet/ui exec vitest run src/components/SettingsOverlay.test.tsx --no-file-parallelism
pnpm --filter @jdcagnet/ui build
```

Expected: PASS and UI build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/stores/settings-store.ts packages/ui/src/components/SettingsOverlay.tsx packages/ui/src/components/SettingsOverlay.test.tsx packages/ui/src/lib/ipc-client.ts
git commit -m "feat(ui): add feishu bot settings"
```

---

## Task 10: End-to-End Regression and Cache Safety

**Files:**
- Create: `packages/electron/src/feishu/feishu-session-integration.test.ts`
- Modify only files needed by failing tests from this task.

- [ ] **Step 1: Add integration regression test**

Create `packages/electron/src/feishu/feishu-session-integration.test.ts` with a fake provider/session manager seam. The test should assert:

- inbound Feishu text invokes `SessionManager.sendMessage()`;
- no Feishu event id, message id, or chat title is passed into `text`;
- sink receives finish;
- duplicate event does not invoke send twice.

Use this assertion shape:

```ts
expect(sessions.sendMessage).toHaveBeenCalledWith(
  'session_1',
  '用户问题',
  undefined,
  expect.objectContaining({
    sink: expect.any(Object),
    interactionSink: expect.any(Object),
  })
)
expect(JSON.stringify(sessions.sendMessage.mock.calls[0])).not.toContain('event_1')
expect(JSON.stringify(sessions.sendMessage.mock.calls[0])).not.toContain('message_1')
```

- [ ] **Step 2: Run focused regression**

Run:

```bash
pnpm --filter jdcagnet exec vitest run src/feishu/feishu-session-integration.test.ts --no-file-parallelism
```

Expected: PASS after the previous tasks are complete.

- [ ] **Step 3: Run full relevant verification**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run tests/external-conversations.test.ts --no-file-parallelism
pnpm --filter jdcagnet exec vitest run src/session-event-sink.test.ts src/session-interactions.test.ts src/feishu/binding-store.test.ts src/feishu/conversation-resolver.test.ts src/feishu/feishu-sink.test.ts src/feishu/bridge.test.ts src/feishu/main-lifecycle.test.ts src/feishu/feishu-session-integration.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/ui exec vitest run src/components/SettingsOverlay.test.tsx --no-file-parallelism
pnpm --filter @jdcagnet/core build
pnpm --filter jdcagnet build
pnpm --filter @jdcagnet/ui build
git diff --check
```

Expected: all commands pass.

- [ ] **Step 4: Commit verification fixes if any were required**

If Step 3 required code changes, commit those changes:

```bash
git add packages/core packages/electron packages/ui pnpm-lock.yaml
git commit -m "test(feishu): cover bot session integration"
```

If Step 3 required no code changes, do not create an empty commit.

---

## Execution Notes

- Keep Feishu metadata out of system prompts. Persist event ids and message ids in mapping tables only.
- Do not create a Feishu-specific provider call path.
- Do not remove, hide, or simplify JDC tools for Feishu-originated sessions.
- Do not route project `cwd` from Feishu text.
- Keep one bot binding to one `cwd`; support multiple bindings.
- Prefer fake Feishu client tests until the final SDK adapter task.
- If `@larksuiteoapi/node-sdk` bundling fails in Electron build, first inspect the exact build error. Only then add the package to `external` in `packages/electron/build.mjs` and verify runtime import still works.

## Final Verification

Run:

```bash
pnpm --filter @jdcagnet/core test
pnpm --filter jdcagnet build
pnpm --filter @jdcagnet/ui build
git diff --check
```

Expected: all commands pass before reporting implementation complete.
