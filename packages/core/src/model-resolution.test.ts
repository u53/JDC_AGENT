import { describe, expect, it } from 'vitest'
import { resolveConfiguredModel } from './model-resolution.js'

const groups = [
  {
    id: 'official',
    name: 'Official Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'sk-official',
    models: [
      { id: 'uuid-opus-official', modelId: 'claude-opus-4-1', name: 'Opus Official', maxTokens: 32000, contextWindow: 200000, compressAt: 0.9 },
      { id: 'uuid-sonnet', modelId: 'claude-sonnet-4-5', name: 'Sonnet', maxTokens: 32000, contextWindow: 200000, compressAt: 0.9 },
    ],
  },
  {
    id: 'proxy',
    name: 'Company Proxy',
    protocol: 'openai-responses',
    baseUrl: 'https://models.company.local',
    apiKey: 'sk-proxy',
    models: [
      { id: 'uuid-opus-proxy', modelId: 'claude-opus-4-1', name: 'Opus Proxy', maxTokens: 64000, contextWindow: 300000, compressAt: 0.92 },
      { id: 'uuid-gpt', modelId: 'gpt-5.5', name: 'gpt-5.5', maxTokens: 32000, contextWindow: 258000, compressAt: 0.9 },
      { id: 'uuid-ds', modelId: 'deepseek-reasoner', name: '公司 DeepSeek', maxTokens: 32000, contextWindow: 128000, compressAt: 0.9 },
    ],
  },
]

describe('resolveConfiguredModel', () => {
  it('resolves composite groupId:modelId without cross-group collision', () => {
    const result = resolveConfiguredModel(groups, 'proxy:claude-opus-4-1')
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.model.groupId).toBe('proxy')
    expect(result.model.modelId).toBe('claude-opus-4-1')
    expect(result.model.contextWindow).toBe(300000)
  })

  it('resolves stored UUID model ids', () => {
    const result = resolveConfiguredModel(groups, 'uuid-sonnet')
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.model.groupId).toBe('official')
    expect(result.model.modelId).toBe('claude-sonnet-4-5')
  })

  it('resolves display names when they are unique', () => {
    const result = resolveConfiguredModel(groups, '公司 DeepSeek')
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.model.groupId).toBe('proxy')
    expect(result.model.modelId).toBe('deepseek-reasoner')
  })

  it('resolves model names case-insensitively', () => {
    const result = resolveConfiguredModel(groups, 'GPT-5.5')
    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.model.groupId).toBe('proxy')
    expect(result.model.modelId).toBe('gpt-5.5')
  })

  it('rejects ambiguous bare API model ids instead of choosing the first group', () => {
    const result = resolveConfiguredModel(groups, 'claude-opus-4-1')
    expect(result.status).toBe('ambiguous')
    if (result.status !== 'ambiguous') return
    expect(result.matches.map((m: { groupId: string }) => m.groupId)).toEqual(['official', 'proxy'])
    expect(result.message).toContain('official:claude-opus-4-1')
    expect(result.message).toContain('proxy:claude-opus-4-1')
  })

  it('returns not_found with a useful message for unknown requests', () => {
    const result = resolveConfiguredModel(groups, 'missing-model')
    expect(result.status).toBe('not_found')
    expect(result.message).toContain('missing-model')
  })
})
