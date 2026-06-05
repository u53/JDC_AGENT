import type { Message } from '../../types.js'
import type { ContextRequest } from '../types.js'
import {
  citationFor,
  nowFromRequest,
  providerHealth,
  rawEvidence,
  section,
  textFromContentBlocks,
} from './shared.js'

const SOURCE = 'ConversationSignalProvider'

export interface ConversationProviderOptions {
  enabled?: boolean
  maxMessages?: number
}

export function collectConversationContext(request: ContextRequest, options: ConversationProviderOptions = {}) {
  if (options.enabled === false) {
    const createdAt = nowFromRequest(request)
    return { evidence: [], sections: [], diagnostics: [], health: providerHealth('conversation', 'disabled', createdAt) }
  }

  const capturedAt = nowFromRequest(request)
  const recent = request.recentMessages.slice(-(options.maxMessages ?? 6))
  const evidence = recent
    .map((message) => messageEvidence(request, message, capturedAt))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  const currentIntent = request.userMessage.trim()
  if (currentIntent) {
    evidence.push(rawEvidence(request, SOURCE, 'message', currentIntent, { messageId: 'current_user_message', role: 'user', current: true }, capturedAt))
  }

  const citations = evidence.map((item) => citationFor(item, String(item.metadata.messageId ?? item.id)))
  const transcript = evidence
    .map((item) => `${String(item.metadata.role ?? 'message')}: ${item.content}`)
    .join('\n')

  return {
    evidence,
    sections: transcript ? [section(
      [request.sessionId, SOURCE, transcript],
      'conversation_state',
      'Conversation state',
      transcript,
      citations,
      75,
      0.88,
      'live',
      SOURCE,
      { authority: 'derived_state', topic: 'conversation', conflictPolicy: 'suppress_if_carried' },
    )] : [],
    diagnostics: [],
    health: providerHealth('conversation', 'enabled', capturedAt),
  }
}

function messageEvidence(request: ContextRequest, message: Message, capturedAt: number) {
  const text = textFromContentBlocks(message.content).trim()
  if (!text) return null
  return rawEvidence(request, SOURCE, 'message', text, { messageId: message.id, role: message.role, timestamp: message.timestamp }, capturedAt)
}
