import { describe, expect, it } from 'vitest'
import { formatModelReference } from './model-display'
import type { ModelGroup } from '../stores/model-store'

const groups: ModelGroup[] = [{
  id: 'group-uuid-1',
  name: '公司DS',
  protocol: 'openai-responses',
  baseUrl: 'https://api.example.com/v1',
  apiKey: '',
  models: [{
    id: 'model-entry-1',
    modelId: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    contextWindow: 200000,
    maxTokens: 32000,
    compressAt: 0.9,
  }],
}]

describe('formatModelReference', () => {
  it('formats runtime groupId:modelId values with configured display names', () => {
    expect(formatModelReference('group-uuid-1:deepseek-v4-flash', groups)).toBe('公司DS:DeepSeek V4 Flash')
  })

  it('formats groupName:modelId values with configured display names', () => {
    expect(formatModelReference('公司DS:deepseek-v4-flash', groups)).toBe('公司DS:DeepSeek V4 Flash')
  })

  it('formats model entry ids and bare model ids when they resolve uniquely', () => {
    expect(formatModelReference('model-entry-1', groups)).toBe('公司DS:DeepSeek V4 Flash')
    expect(formatModelReference('deepseek-v4-flash', groups)).toBe('公司DS:DeepSeek V4 Flash')
  })

  it('falls back to the raw value when the model is not configured', () => {
    expect(formatModelReference('unknown:model', groups)).toBe('unknown:model')
  })
})
