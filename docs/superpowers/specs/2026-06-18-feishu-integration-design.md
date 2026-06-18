# Feishu Integration Design

## Date

2026-06-18

## Summary

JDCAGNET will support Feishu access through a self-built Feishu bot. For the first version, the bot runs as an Electron main-process bridge while the desktop app is open. The bridge uses Feishu long-connection events, maps one bot binding to one JDC workspace project, and forwards Feishu messages into the existing JDC `Session` runtime.

Feishu is only a client transport. It must not create a separate chat engine, prompt builder, tool runner, compaction path, or context store. All normal JDC capabilities, including tools, MCP, skills, subagents, teams, JDC Context Engine snapshot injection, usage tracking, micro compaction, and full compaction, must continue through the same session path used by the desktop chat UI.

## Goals

- Bind a Feishu bot to a JDC workspace, where workspace means a project `cwd`.
- Receive Feishu single-chat and group-chat messages while the desktop app is running.
- Route Feishu turns into normal JDC sessions, preserving existing history, usage, compaction, and context behavior.
- Support the normal tool surface without creating a reduced bot-only mode.
- Return assistant text, tool progress, background notifications, team notifications, compact events, errors, and final status back to Feishu.
- Keep provider cache behavior stable by avoiding dynamic Feishu metadata in system prompts.
- Use Feishu long-connection mode first, so local users do not need to expose an HTTP callback endpoint.
- Keep the internal boundary clean enough that a future headless gateway can reuse the same connector/runtime interfaces.

## Non-Goals

- Do not build a standalone server gateway in the first version.
- Do not require a public callback URL in the first version.
- Do not create a second Feishu-specific prompt assembly path.
- Do not store a second complete conversation transcript outside JDC session history.
- Do not simplify or remove existing JDC tools for Feishu conversations.
- Do not solve multi-machine high availability in this design.
- Do not make Feishu the source of truth for projects, sessions, tasks, or context memory.

## Recommended Architecture

Use an Electron-embedded `FeishuBridge` plus a shared session event sink abstraction.

```text
Feishu Bot Long Connection
        |
        v
FeishuBridge
        |
        v
BindingResolver  ->  FeishuBindingStore
        |
        v
ConversationResolver  ->  ExternalConversationMapping
        |
        v
SessionManager / Session
        |
        v
SessionEventSink
        |
        +--> DesktopUiSink
        |
        +--> FeishuSink
```

The important design decision is that Feishu does not call model providers directly. It resolves a JDC session and then calls the same session send path as the desktop UI.

The first implementation can live under `packages/electron/src/feishu/` because the user expects the desktop app and computer to stay online. The bridge should still depend on interfaces rather than `BrowserWindow` so it can later move into a headless process with minimal changes.

## Components

### FeishuBridge

Owns Feishu connectivity.

- Starts and stops with the Electron app.
- Uses Feishu self-built app credentials.
- Connects through Feishu long-connection event mode.
- Receives message events.
- Performs event verification, decryption if configured, and idempotency checks.
- Delegates project/session resolution to separate components.
- Does not understand prompt assembly or model provider details.

### FeishuBindingStore

Stores bot-to-project configuration.

Recommended first-version config shape:

```ts
interface FeishuBinding {
  id: string
  enabled: boolean
  appId: string
  appSecretRef: string
  tenantKey?: string
  verificationToken?: string
  encryptKeyRef?: string
  projectName: string
  cwd: string
  defaultModelId?: string
  permissionMode?: 'standard' | 'relaxed' | 'strict'
  allowedChatIds?: string[]
  allowedOpenIds?: string[]
  sessionStrategy: 'thread' | 'chat'
  createdAt: number
  updatedAt: number
}
```

Secrets should be stored through the existing app config mechanism only if that is already the product convention. If a platform keychain abstraction is available later, `appSecretRef` and `encryptKeyRef` should point to keychain entries.

One Feishu bot can bind to one project `cwd` in the first version. Supporting multiple projects behind one bot can be a later extension through explicit commands or chat allowlist routing.

### ConversationResolver

Maps a Feishu conversation to a JDC session.

Recommended mapping key:

```text
channel = feishu
binding_id
tenant_key
chat_id
thread_key
user_key
```

For group chat, `thread_key` should use the Feishu message thread/root identifier when available. If there is no thread context, it falls back to the chat id. For single chat, the mapping uses the chat id and sender id.

Commands:

- `/new`: create a new JDC session under the bound project.
- `/status`: show current run status for the mapped session.
- `/stop`: abort the active run for the mapped session.
- `/compact`: manually trigger `compactNow()` for the mapped session.
- `/session`: show the mapped JDC session id and title.

All commands operate inside the bound project only.

### SessionEventSink

Extract the current UI-only event wiring into a small interface.

```ts
interface SessionEventSink {
  stream(sessionId: string, chunk: StreamChunk): void
  toolEvent(sessionId: string, event: ToolExecutionEvent): void
  messageComplete(sessionId: string, message: Message): void
  messagesReplaced(sessionId: string, messages: Message[]): void
  usage(sessionId: string, usage: UsageSnapshot): void
  retrying?(sessionId: string, event: RetryEvent): void
  error(sessionId: string, error: Error): void
  finished(sessionId: string): void
}
```

The desktop UI sink continues to send Electron IPC events. The Feishu sink converts the same runtime events into bot replies, cards, or status messages.

This boundary is required because `SessionManager` currently mixes runtime orchestration with `BrowserWindow` delivery. Feishu needs the runtime, not the browser window.

### FeishuSink

Converts session events into Feishu output.

- Sends an initial "processing" message or card.
- Buffers streaming text and updates Feishu at a controlled cadence, or sends final text only if rate limits make updates noisy.
- Summarizes tool start/complete/error events into concise visible status.
- Splits long assistant replies into multiple messages.
- Uses file upload or rich text card later for very long outputs.
- Sends compact completion/failure as a short status message.
- Sends background shell, agent, image, and team notifications back to the mapped Feishu thread.
- Preserves detailed tool output in normal JDC history rather than dumping every large tool result into Feishu.

## Data Model

Add external mapping tables to the existing history database or a nearby app-level database.

```ts
interface ExternalConversationMapping {
  id: string
  channel: 'feishu'
  bindingId: string
  tenantKey?: string
  chatId: string
  threadKey: string
  userKey?: string
  cwd: string
  sessionId: string
  state: 'active' | 'archived'
  createdAt: number
  updatedAt: number
}
```

```ts
interface ExternalEventDedupe {
  channel: 'feishu'
  eventId: string
  messageId?: string
  bindingId: string
  receivedAt: number
  processedAt?: number
  status: 'processing' | 'processed' | 'failed'
}
```

```ts
interface ExternalMessageMapping {
  channel: 'feishu'
  bindingId: string
  sessionId: string
  feishuMessageId: string
  jdcMessageId?: string
  replyMessageId?: string
  createdAt: number
}
```

The JDC `messages` table remains the source of truth for conversation content. External mapping tables only provide routing, idempotency, and reply correlation.

## Message Flow

1. Electron app starts and loads enabled Feishu bindings.
2. `FeishuBridge` opens long-connection subscriptions for enabled bots.
3. Feishu emits a message event.
4. The bridge verifies the event and checks `ExternalEventDedupe`.
5. `BindingResolver` finds the project `cwd` for the bot.
6. Authorization checks verify the chat/user is allowed.
7. `ConversationResolver` finds or creates a JDC session under that `cwd`.
8. The bridge calls the normal session send path with a Feishu event sink.
9. `Session.sendMessage()` persists the user message in normal history.
10. `Session.runLoop()` prepares system prompt, micro compacts, full compacts if needed, injects JDC Context Engine snapshot, streams the provider, executes tools, and persists assistant/tool messages.
11. `FeishuSink` sends visible progress and final output back to the Feishu chat/thread.
12. Background notifications later call the same event sink and reply to the mapped Feishu thread.

## Compaction and Cache Contract

Feishu must preserve the existing session compaction contract:

- User messages from Feishu are normal JDC user messages.
- Assistant messages and tool results are normal JDC history entries.
- `microCompact()` and `compactNow()` operate on the same message list as desktop sessions.
- `usageTracker` and `history.saveUsage()` remain session-scoped.
- `history.replaceMessages()` remains the only full-compaction persistence path.
- JDC Context Engine prompt snapshots are resolved inside `Session.runLoop()` exactly as desktop chat does.

Feishu-specific metadata must not be appended to the base system prompt. The bridge may persist metadata in mapping tables and may add a small user-visible prefix only when needed, but dynamic identifiers such as event id, message id, timestamps, retry counters, and chat titles must stay out of system prompt assembly.

The model config should keep the same `cacheKey` and `cacheUser` semantics as normal main sessions. A Feishu turn should not change provider prompt shape beyond the actual user message.

## Tools, Permissions, and Human Interaction

The default tool set remains the normal JDC tool set for the session.

Permission handling:

- If a tool needs approval, `FeishuBridge` sends an approval card or confirmation message to the authorized Feishu user or group.
- The approval response resolves the existing permission callback.
- If no approval arrives before timeout, the tool is denied with a clear error.
- Session-level `permissionMode` can be configured per binding.

Ask-user handling:

- `AskUser` prompts are sent to Feishu and wait for a reply from the authorized user/thread.
- Multi-choice questions should render as buttons when Feishu cards are available.

Plan review:

- Plan approval should use Feishu card buttons or explicit reply commands.
- If card actions are unavailable, the bridge can accept textual `approve`/`reject: reason` replies in the mapped thread.

Desktop-only affordances:

- IDE selection context is only available if the desktop IDE bridge has active context for the same project.
- Opening a local diff or file in the desktop app can still happen if the desktop UI is present.
- When a feature requires visual UI interaction, Feishu should receive a clear prompt instead of silently failing.

## Background Tasks, Subagents, and Teams

No special Feishu implementation is needed for subagents or teams because they already inherit `cwd`, tool registry, context engine, and compaction behavior from the parent session.

The Feishu integration must ensure:

- `onNotificationReady` is routed to the Feishu sink for sessions created or used from Feishu.
- Background shell completion is posted to the mapped Feishu thread.
- Agent completion is posted to the mapped Feishu thread.
- Team progress and team completion notifications are posted to the mapped Feishu thread.
- `/stop` can abort the main session run and should use existing abort paths for active agents when applicable.

The bridge must not run a second shadow task for Feishu. It only observes and forwards the existing runtime events.

## Security

- Only enabled bindings may receive events.
- Every incoming event must be verified through Feishu credentials.
- Event ids and message ids must be deduplicated before invoking the model.
- `allowedChatIds` and `allowedOpenIds` should be enforced before session creation.
- Project `cwd` must never be selected from user-provided Feishu text.
- Secrets must not be inserted into messages, prompts, logs, or Feishu replies.
- Tool approval cards must include the tool name and a concise input summary.
- Dangerous tools should still follow existing JDC permission policy. Feishu does not bypass permission checks.

## Error Handling

- Invalid signature or decrypt failure: log diagnostic, do not reply with internal details.
- Unknown binding: ignore the event or reply with a generic disabled message if the event is from an allowed admin chat.
- Unauthorized chat/user: reply with a short unauthorized message only if safe.
- Duplicate event: return without invoking the session.
- Session creation failure: reply with the project binding error.
- Model/provider error: forward the session error through Feishu and mark the run finished.
- Feishu send failure: retry with bounded backoff and persist the failed reply mapping for diagnosis.
- App restart: reconnect Feishu long connection, reload mappings, and continue future turns. Interrupted in-flight runs are not guaranteed to resume.

## Observability

Add structured logs for:

- Feishu connection lifecycle.
- Binding load/enable/disable.
- Event id, message id, chat id, and mapping id.
- Session id resolved or created.
- Authorization decision.
- Tool approval request and result.
- Feishu reply send success/failure.
- Dedupe hits.
- Compact events and usage snapshots through existing session events.

Diagnostics should show enough correlation to debug a Feishu request without exposing secrets or full prompt content.

## UI and Configuration

First version can expose a minimal settings panel:

- Enable Feishu integration.
- Add/edit one bot binding.
- Choose project `cwd`.
- Set allowlisted chat ids and user ids.
- Pick default model or use global active model.
- Pick permission mode.
- Show connection status and last error.

If UI work is deferred, the bridge may start from config file support, but the binding format must still match the planned UI shape.

## Testing Plan

- Unit test `ConversationResolver` mapping group chat, single chat, thread fallback, and `/new`.
- Unit test event dedupe prevents duplicate model invocation.
- Unit test unauthorized chat/user is rejected before session creation.
- Unit test Feishu metadata is not appended to system prompt.
- Unit test Feishu send path calls the same `Session.sendMessage()` path as desktop chat.
- Unit test compact events from `Session.compactNow()` are forwarded by `FeishuSink`.
- Integration test with a fake Feishu client:
  - incoming message creates a session under the bound `cwd`;
  - assistant output is posted back;
  - tool event is summarized;
  - background notification is posted after run completion.
- Regression test that Feishu-created sessions still trigger JDC Context Engine snapshot injection and normal compaction thresholds.

## Validation Commands

```bash
pnpm --filter @jdcagnet/core test
```

```bash
pnpm --filter @jdcagnet/electron build
```

```bash
git diff --check
```

## Implementation Notes

Likely first implementation steps:

1. Extract a `SessionEventSink` or equivalent event factory from `SessionManager`.
2. Add an event sink multiplexer so desktop UI and external clients can observe the same session.
3. Add Feishu binding config and mapping persistence.
4. Add the Electron `FeishuBridge` long-connection lifecycle.
5. Implement text message receive/reply first.
6. Add permission approval and ask-user handling.
7. Add background notification forwarding.
8. Add UI configuration after the runtime path is stable.

These notes are sequencing guidance only. A separate implementation plan should be written before code changes.

## Feishu References

- Receive message event: https://open.feishu.cn/document/server-docs/im-v1/message/events/receive
- Send message API: https://open.feishu.cn/document/server-docs/im-v1/message/create
- Event subscription and long connection entry: https://open.feishu.cn/document/server-docs/event-subscription-guide/overview
