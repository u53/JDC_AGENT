import type { ContextDistiller } from './index.js'
import { completeDistillerEnvelopeWithModel } from './model-client.js'

export const projectProfileDistiller: ContextDistiller = {
  name: 'ProjectProfileDistiller',
  async distill(candidate, context) {
    if (!context.modelClient) throw new Error('ProjectProfileDistiller requires a captured model binding client')
    return completeDistillerEnvelopeWithModel({
      distiller: 'ProjectProfileDistiller',
      candidate,
      binding: context.modelBinding,
      maxOutputTokens: context.maxOutputTokens,
    }, context.modelClient)
  },
}
