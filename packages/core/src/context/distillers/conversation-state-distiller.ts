import type { ContextDistiller } from './index.js'
import { completeDistillerEnvelopeWithModel } from './model-client.js'

export const conversationStateDistiller: ContextDistiller = {
  name: 'ConversationStateDistiller',
  async distill(candidate, context) {
    if (!context.modelClient) throw new Error('ConversationStateDistiller requires a captured model binding client')
    return completeDistillerEnvelopeWithModel({
      distiller: 'ConversationStateDistiller',
      candidate,
      binding: context.modelBinding,
      maxOutputTokens: context.maxOutputTokens,
    }, context.modelClient)
  },
}
