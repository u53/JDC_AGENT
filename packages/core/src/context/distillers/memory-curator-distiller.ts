import type { ContextDistiller } from './index.js'
import { completeDistillerEnvelopeWithModel } from './model-client.js'

export const memoryCuratorDistiller: ContextDistiller = {
  name: 'MemoryCuratorDistiller',
  async distill(candidate, context) {
    if (!context.modelClient) throw new Error('MemoryCuratorDistiller requires a captured model binding client')
    return completeDistillerEnvelopeWithModel({
      distiller: 'MemoryCuratorDistiller',
      candidate,
      binding: context.modelBinding,
      maxOutputTokens: context.maxOutputTokens,
    }, context.modelClient)
  },
}
