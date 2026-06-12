import { describe, it, expect } from 'vitest'
import { resolveOutputSize, clampCompression, QUALITY_OPTIONS, FORMAT_OPTIONS, SIZE_PRESETS } from './image-presets.js'

describe('resolveOutputSize', () => {
  it('auto 返回 null', () => {
    expect(resolveOutputSize('auto')).toEqual({ width: null, height: null })
  })
  it('空字符串返回 null', () => {
    expect(resolveOutputSize('')).toEqual({ width: null, height: null })
  })
  it('合法尺寸返回宽高', () => {
    expect(resolveOutputSize('3840x2160')).toEqual({ width: 3840, height: 2160 })
    expect(resolveOutputSize('1024x1024')).toEqual({ width: 1024, height: 1024 })
  })
  it('格式非法报错', () => {
    expect(() => resolveOutputSize('1024*1024')).toThrow('尺寸格式必须是 宽x高')
    expect(() => resolveOutputSize('abc')).toThrow('尺寸格式必须是 宽x高')
  })
  it('非 16 倍数报错', () => {
    expect(() => resolveOutputSize('1000x1000')).toThrow('16 的倍数')
    expect(() => resolveOutputSize('1024x1000')).toThrow('16 的倍数')
  })
  it('宽高为 0 或负数报错', () => {
    expect(() => resolveOutputSize('0x0')).toThrow('宽高必须大于 0')
  })
  it('比例超过 3:1 报错', () => {
    expect(() => resolveOutputSize('4096x1024')).toThrow('3:1')
  })
  it('合法比例边界（3:1 正好通过）', () => {
    expect(resolveOutputSize('3072x1024')).toEqual({ width: 3072, height: 1024 })
  })
})

describe('clampCompression', () => {
  it('正常值不变', () => expect(clampCompression(80)).toBe(80))
  it('超出上限夹到 100', () => expect(clampCompression(150)).toBe(100))
  it('负数夹到 0', () => expect(clampCompression(-5)).toBe(0))
  it('NaN 返回 100', () => expect(clampCompression(NaN)).toBe(100))
  it('浮点截断', () => expect(clampCompression(80.7)).toBe(80))
})

describe('常量', () => {
  it('SIZE_PRESETS 包含 4K 横竖图', () => {
    const values = SIZE_PRESETS.map((p) => p.value)
    expect(values).toContain('3840x2160')
    expect(values).toContain('2160x3840')
  })
  it('QUALITY_OPTIONS 完整', () => {
    expect(QUALITY_OPTIONS).toEqual(['auto', 'low', 'medium', 'high'])
  })
  it('FORMAT_OPTIONS 完整', () => {
    expect(FORMAT_OPTIONS).toEqual(['png', 'jpeg', 'webp'])
  })
})
