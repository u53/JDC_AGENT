import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadImageModelConfig, isImageModelConfigured } from './image-config.js'

vi.mock('../config.js', () => ({
  loadAppConfig: vi.fn(),
}))

import { loadAppConfig } from '../config.js'
const mockedConfig = vi.mocked(loadAppConfig)

describe('loadImageModelConfig', () => {
  beforeEach(() => {
    mockedConfig.mockReset()
  })
  it('无配置返回 null', () => {
    mockedConfig.mockReturnValue({})
    expect(loadImageModelConfig()).toBeNull()
  })
  it('enabled=false 返回 null', () => {
    mockedConfig.mockReturnValue({ imageModel: { enabled: false, baseUrl: 'https://x', apiKey: 'k', model: 'm' } })
    expect(loadImageModelConfig()).toBeNull()
  })
  it('缺 apiKey 返回 null', () => {
    mockedConfig.mockReturnValue({ imageModel: { enabled: true, baseUrl: 'https://x', apiKey: '', model: 'm' } })
    expect(loadImageModelConfig()).toBeNull()
  })
  it('缺 baseUrl 返回 null', () => {
    mockedConfig.mockReturnValue({ imageModel: { enabled: true, baseUrl: '', apiKey: 'k', model: 'm' } })
    expect(loadImageModelConfig()).toBeNull()
  })
  it('缺 model 返回 null', () => {
    mockedConfig.mockReturnValue({ imageModel: { enabled: true, baseUrl: 'https://x', apiKey: 'k', model: '' } })
    expect(loadImageModelConfig()).toBeNull()
  })
  it('完整配置返回对象', () => {
    mockedConfig.mockReturnValue({ imageModel: { enabled: true, baseUrl: 'https://x', apiKey: 'k', model: 'm' } })
    expect(loadImageModelConfig()).toEqual({ enabled: true, baseUrl: 'https://x', apiKey: 'k', model: 'm' })
  })
  it('trim 处理', () => {
    mockedConfig.mockReturnValue({ imageModel: { enabled: true, baseUrl: '  https://x  ', apiKey: '  k  ', model: '  m  ' } })
    expect(loadImageModelConfig()).toEqual({ enabled: true, baseUrl: 'https://x', apiKey: 'k', model: 'm' })
  })
})

describe('isImageModelConfigured', () => {
  beforeEach(() => { mockedConfig.mockReset() })
  it('有配置返回 true', () => {
    mockedConfig.mockReturnValue({ imageModel: { enabled: true, baseUrl: 'https://x', apiKey: 'k', model: 'm' } })
    expect(isImageModelConfigured()).toBe(true)
  })
  it('无配置返回 false', () => {
    mockedConfig.mockReturnValue({})
    expect(isImageModelConfigured()).toBe(false)
  })
})
