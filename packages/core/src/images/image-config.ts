import { loadAppConfig } from '../config.js'

export interface ImageModelConfig {
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
}

export function loadImageModelConfig(): ImageModelConfig | null {
  const raw = (loadAppConfig().imageModel ?? null) as Partial<ImageModelConfig> | null
  if (!raw) return null
  const enabled = raw.enabled === true
  const baseUrl = (raw.baseUrl ?? '').trim()
  const apiKey = (raw.apiKey ?? '').trim()
  const model = (raw.model ?? '').trim()
  if (!enabled || !baseUrl || !apiKey || !model) return null
  return { enabled, baseUrl, apiKey, model }
}

export function isImageModelConfigured(): boolean {
  return loadImageModelConfig() !== null
}
