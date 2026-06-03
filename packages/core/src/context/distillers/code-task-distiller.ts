import type { ContextDistiller } from './index.js'
import { completeDistillerEnvelopeWithModel } from './model-client.js'

export const codeTaskDistiller: ContextDistiller = {
  name: 'CodeTaskDistiller',
  async distill(candidate, context) {
    if (!context.modelClient) throw new Error('CodeTaskDistiller requires a captured model binding client')
    return completeDistillerEnvelopeWithModel({
      distiller: 'CodeTaskDistiller',
      candidate,
      binding: context.modelBinding,
      maxOutputTokens: context.maxOutputTokens,
    }, context.modelClient)
  },
}
