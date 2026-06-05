import type { ContextRequest, ToolExecutionEvent } from '../types.js'
import type { ToolExecutionEvent as ToolRunnerExecutionEvent } from '../../tool-runner.js'
import {
  citationFor,
  nowFromRequest,
  providerHealth,
  rawEvidence,
  section,
  stableId,
} from './shared.js'

const SOURCE = 'RuntimeSignalProvider'

export interface RuntimeProviderOptions {
  enabled?: boolean
}

export function collectRuntimeContext(request: ContextRequest, options: RuntimeProviderOptions = {}) {
  const capturedAt = nowFromRequest(request)
  if (options.enabled === false) {
    return { evidence: [], sections: [], diagnostics: [], health: providerHealth('runtime', 'disabled', capturedAt) }
  }

  const events = runtimeToolEvents(request.runtime)
  const evidence = events.map((event, index) => {
    const eventId = toolEventId(event, request.sessionId, index)
    const content = formatToolEvent(event, eventId)
    return rawEvidence(request, SOURCE, 'tool_event', content, { eventId, ...event }, capturedAt)
  })

  const citations = evidence.map((item) => citationFor(item, String(item.metadata.eventId ?? item.id)))
  const content = evidence.map((item) => item.content).join('\n')

  return {
    evidence,
    sections: content ? [section(
      [request.sessionId, SOURCE, content],
      'runtime_state',
      'Runtime state',
      content,
      citations,
      80,
      0.9,
      'live',
      SOURCE,
      { authority: 'runtime_evidence', topic: 'runtime', conflictPolicy: 'render' },
    )] : [],
    diagnostics: [],
    health: providerHealth('runtime', 'enabled', capturedAt),
  }
}

function runtimeToolEvents(runtime: ContextRequest['runtime']): Array<ToolExecutionEvent | ToolRunnerExecutionEvent> {
  const candidateKeys = ['toolEvents', 'recentToolEvents', 'events']
  for (const key of candidateKeys) {
    const value = runtime[key]
    if (Array.isArray(value)) return value.filter((item): item is ToolExecutionEvent | ToolRunnerExecutionEvent => Boolean(item && typeof item === 'object'))
  }
  return []
}

function toolEventId(event: ToolExecutionEvent | ToolRunnerExecutionEvent, sessionId: string, index: number): string {
  if ('toolUseId' in event && typeof event.toolUseId === 'string' && event.toolUseId) return event.toolUseId
  if ('id' in event && typeof event.id === 'string' && event.id) return event.id
  return stableId('tool_event', sessionId, String(index), JSON.stringify(event))
}

function formatToolEvent(event: ToolExecutionEvent | ToolRunnerExecutionEvent, eventId: string): string {
  const name = toolEventName(event)
  const status = toolEventStatus(event)
  const detail = toolEventDetail(event)
  return `${name} ${status} (${eventId})${detail ? ` — ${detail}` : ''}`
}

function toolEventName(event: ToolExecutionEvent | ToolRunnerExecutionEvent): string {
  if ('toolName' in event && typeof event.toolName === 'string' && event.toolName) return event.toolName
  if ('name' in event && typeof event.name === 'string' && event.name) return event.name
  return 'Tool'
}

function toolEventStatus(event: ToolExecutionEvent | ToolRunnerExecutionEvent): string {
  if ('status' in event && typeof event.status === 'string' && event.status) return event.status
  if ('type' in event && typeof event.type === 'string' && event.type) return event.type
  return 'unknown'
}

function toolEventDetail(event: ToolExecutionEvent | ToolRunnerExecutionEvent): string {
  if ('result' in event && event.result && typeof event.result === 'object') {
    const content = (event.result as { content?: unknown }).content
    if (typeof content === 'string' && content) return content
  }
  if ('message' in event && typeof event.message === 'string' && event.message) return event.message
  return ''
}
