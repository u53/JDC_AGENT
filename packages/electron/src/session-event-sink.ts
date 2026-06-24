import type { BrowserWindow } from 'electron'
import type { Message, SessionEvents, StreamChunk, ToolExecutionEvent, UsageSnapshot } from '@jdcagnet/core'

export interface RetrySinkEvent {
  attempt: number
  maxRetries: number
  error: string
  delayMs: number
  category: string
}

type SinkResult = void | Promise<void>

export interface SessionEventSink {
  stream?(sessionId: string, chunk: StreamChunk): SinkResult
  toolEvent?(sessionId: string, event: ToolExecutionEvent): SinkResult
  messageComplete?(sessionId: string, message: Message): SinkResult
  messagesReplaced?(sessionId: string, messages: Message[]): SinkResult
  usage?(sessionId: string, usage: UsageSnapshot): SinkResult
  retrying?(sessionId: string, event: RetrySinkEvent): SinkResult
  error?(sessionId: string, error: Error): SinkResult
  finished?(sessionId: string): SinkResult
  agentProgress?(sessionId: string, agentToolUseId: string, event: any): SinkResult
  agentText?(sessionId: string, agentToolUseId: string, text: string): SinkResult
  agentComplete?(sessionId: string, agentToolUseId: string, result: any): SinkResult
}

export interface SessionInteractionSink {
  requestPermission?(request: { toolName: string; input: Record<string, unknown> }): Promise<boolean>
  askUser?(question: string, options?: string[], multiSelect?: boolean): Promise<string>
  reviewPlan?(planFile: string, content: string): Promise<{ approved: boolean; feedback?: string }>
}

type InteractionFallback = SessionInteractionSink | ((sessionId: string) => SessionInteractionSink)

type PermissionRequest = { toolName: string; input: Record<string, unknown> }
type PlanReviewResult = { approved: boolean; feedback?: string }

export interface InteractionRouter {
  attach(sessionId: string, key: string, sink: SessionInteractionSink): () => void
  clear(sessionId: string): void
  requestPermission(sessionId: string, request: PermissionRequest, key?: string): Promise<boolean>
  askUser(sessionId: string, question: string, options?: string[], multiSelect?: boolean, key?: string): Promise<string>
  reviewPlan(sessionId: string, planFile: string, content: string, key?: string): Promise<PlanReviewResult>
}

export function createInteractionRouter(fallback: InteractionFallback): InteractionRouter {
  const sinks = new Map<string, Map<string, SessionInteractionSink>>()
  const fallbackFor = (sessionId: string) => typeof fallback === 'function' ? fallback(sessionId) : fallback
  const current = (sessionId: string, key?: string) => {
    const sessionSinks = sinks.get(sessionId)
    if (key) return sessionSinks?.get(key)
    const values = Array.from(sessionSinks?.values() ?? [])
    return values[values.length - 1]
  }

  const pickSink = (sessionId: string, key: string | undefined, method: keyof SessionInteractionSink) => {
    const sink = current(sessionId, key)
    return sink?.[method] ? sink : fallbackFor(sessionId)
  }

  return {
    attach(sessionId: string, key: string, sink: SessionInteractionSink) {
      const sessionSinks = sinks.get(sessionId) ?? new Map<string, SessionInteractionSink>()
      sessionSinks.set(key, sink)
      sinks.set(sessionId, sessionSinks)
      return () => {
        if (sessionSinks.get(key) !== sink) return
        sessionSinks.delete(key)
        if (sessionSinks.size === 0) sinks.delete(sessionId)
      }
    },
    clear(sessionId: string) {
      sinks.delete(sessionId)
    },
    requestPermission(sessionId: string, request: PermissionRequest, key?: string) {
      const sink = pickSink(sessionId, key, 'requestPermission')
      return sink.requestPermission?.(request) ?? Promise.resolve(false)
    },
    askUser(sessionId: string, question: string, options?: string[], multiSelect?: boolean, key?: string) {
      const sink = pickSink(sessionId, key, 'askUser')
      return sink.askUser?.(question, options, multiSelect) ?? Promise.resolve('')
    },
    reviewPlan(sessionId: string, planFile: string, content: string, key?: string) {
      const sink = pickSink(sessionId, key, 'reviewPlan')
      return sink.reviewPlan?.(planFile, content) ?? Promise.resolve({ approved: false, feedback: 'No review handler is available.' })
    },
  }
}

type SinkMethod = keyof SessionEventSink

function isCatchable(value: unknown): value is { catch: (onRejected: (error: unknown) => void) => unknown } {
  return Boolean(value && typeof (value as { catch?: unknown }).catch === 'function')
}

function fanOut(sinks: SessionEventSink[], method: SinkMethod, args: unknown[]): void {
  for (const sink of sinks) {
    try {
      const result = (sink[method] as ((...args: unknown[]) => SinkResult) | undefined)?.(...args)
      if (isCatchable(result)) {
        result.catch(error => console.error('[session-sink] sink failed:', error))
      }
    } catch (error) {
      console.error('[session-sink] sink failed:', error)
    }
  }
}

export function createSinkMultiplexer(sinks: SessionEventSink[]): SessionEventSink {
  return {
    stream: (sessionId, chunk) => fanOut(sinks, 'stream', [sessionId, chunk]),
    toolEvent: (sessionId, event) => fanOut(sinks, 'toolEvent', [sessionId, event]),
    messageComplete: (sessionId, message) => fanOut(sinks, 'messageComplete', [sessionId, message]),
    messagesReplaced: (sessionId, messages) => fanOut(sinks, 'messagesReplaced', [sessionId, messages]),
    usage: (sessionId, usage) => fanOut(sinks, 'usage', [sessionId, usage]),
    retrying: (sessionId, event) => fanOut(sinks, 'retrying', [sessionId, event]),
    error: (sessionId, error) => fanOut(sinks, 'error', [sessionId, error]),
    finished: (sessionId) => fanOut(sinks, 'finished', [sessionId]),
    agentProgress: (sessionId, agentToolUseId, event) => fanOut(sinks, 'agentProgress', [sessionId, agentToolUseId, event]),
    agentText: (sessionId, agentToolUseId, text) => fanOut(sinks, 'agentText', [sessionId, agentToolUseId, text]),
    agentComplete: (sessionId, agentToolUseId, result) => fanOut(sinks, 'agentComplete', [sessionId, agentToolUseId, result]),
  }
}

export function createSessionEvents(sessionId: string, sink: SessionEventSink): SessionEvents {
  return {
    onStreamChunk: (chunk) => sink.stream?.(sessionId, chunk),
    onToolEvent: (event) => sink.toolEvent?.(sessionId, event),
    onMessageComplete: (message) => sink.messageComplete?.(sessionId, message),
    onMessagesReplaced: (messages) => sink.messagesReplaced?.(sessionId, messages),
    onError: (error) => sink.error?.(sessionId, error),
    onRetrying: (attempt, error, delayMs, category, maxRetries) => {
      sink.retrying?.(sessionId, {
        attempt,
        maxRetries,
        error: error.message || String(error),
        delayMs,
        category,
      })
    },
    onUsage: (usage) => sink.usage?.(sessionId, usage),
    onAgentProgress: (agentToolUseId, event) => sink.agentProgress?.(sessionId, agentToolUseId, event),
    onAgentText: (agentToolUseId, text) => sink.agentText?.(sessionId, agentToolUseId, text),
    onAgentComplete: (agentToolUseId, result) => sink.agentComplete?.(sessionId, agentToolUseId, result),
  }
}

export function createUiSink(getWindow: () => BrowserWindow | null): SessionEventSink {
  const send = (channel: string, payload: unknown) => {
    getWindow()?.webContents.send(channel, payload)
  }

  return {
    stream: (sessionId, chunk) => send('query:stream', { sessionId, chunk }),
    toolEvent: (sessionId, event) => {
      send('query:tool-event', { sessionId, event })
      if (event.type === 'complete' && event.toolName === 'EnterPlanMode') {
        send('plan:mode-changed', { sessionId, mode: 'planning' })
      } else if (event.type === 'complete' && event.toolName === 'ExitPlanMode') {
        send('plan:mode-changed', { sessionId, mode: 'normal' })
      }
    },
    messageComplete: (sessionId, message) => send('query:complete', { sessionId, message }),
    messagesReplaced: (sessionId, messages) => send('session:messages-updated', { sessionId, messages }),
    usage: (sessionId, usage) => send('query:usage', { sessionId, usage }),
    retrying: (sessionId, event) => send('query:retrying', { sessionId, ...event }),
    error: (sessionId, error) => send('query:error', { sessionId, error: error.message }),
    finished: (sessionId) => send('query:finished', { sessionId }),
    agentProgress: (sessionId, agentToolUseId, event) => send('agent:progress', { sessionId, agentToolUseId, ...event }),
    agentText: (sessionId, agentToolUseId, text) => send('agent:text', { sessionId, agentToolUseId, text }),
    agentComplete: (sessionId, agentToolUseId, result) => send('agent:complete', { sessionId, agentToolUseId, ...result }),
  }
}
