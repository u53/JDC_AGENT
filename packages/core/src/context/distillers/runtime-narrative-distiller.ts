import type { ContextDistiller } from './index.js'
import { completeDistillerEnvelopeWithModel } from './model-client.js'

export const runtimeNarrativeDistiller: ContextDistiller = {
  name: 'RuntimeNarrativeDistiller',
  async distill(candidate, context) {
    if (!context.modelClient) throw new Error('RuntimeNarrativeDistiller requires a captured model binding client')
    return completeDistillerEnvelopeWithModel({
      distiller: 'RuntimeNarrativeDistiller',
      candidate,
      binding: context.modelBinding,
      maxOutputTokens: context.maxOutputTokens,
    }, context.modelClient)
  },
}
