import { HarvestModelBindingSchema } from './schemas.js'
import type { HarvestModelBinding, ProviderProtocol } from './types.js'
import type { ModelConfig } from '../types.js'

export interface CaptureHarvestModelBindingInput {
  sessionId: string
  providerProtocol: ProviderProtocol
  modelId: string
  modelConfig: ModelConfig
  modelGroupId?: string
  baseUrl?: string
}

export function captureHarvestModelBinding(input: CaptureHarvestModelBindingInput): HarvestModelBinding {
  if (!input.providerProtocol) throw new Error('providerProtocol is required to capture harvest model binding')
  if (!input.modelId) throw new Error('modelId is required to capture harvest model binding')

  return HarvestModelBindingSchema.parse({
    sessionId: input.sessionId,
    providerProtocol: input.providerProtocol,
    modelId: input.modelId,
    modelConfig: input.modelConfig,
    modelGroupId: input.modelGroupId,
    baseUrl: input.baseUrl,
    contextWindow: input.modelConfig.contextWindow,
  })
}
