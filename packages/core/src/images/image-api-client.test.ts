import { describe, it, expect } from 'vitest'
import { ImageApiClient, extractImageApiResult, resolveImageApiResult } from './image-api-client.js'

const client = new ImageApiClient('https://api.example.com/', 'key')

describe('buildRequest', () => {
  it('无图走 generations，auto 不传 size', () => {
    const r = client.buildRequest({ prompt: 'cat', size: 'auto', quality: 'auto', model: 'gpt-image-2', outputFormat: 'png', compression: 100 })
    expect(r.url).toBe('https://api.example.com/v1/images/generations')
    expect(r.payload.size).toBeUndefined()
    expect(r.payload).toMatchObject({ model: 'gpt-image-2', prompt: 'cat', quality: 'auto', output_format: 'png' })
  })
  it('有图走 edits，带 images', () => {
    const r = client.buildRequest({ prompt: 'x', size: '1024x1024', quality: 'high', model: 'm', outputFormat: 'png', compression: 100, imageDataUrls: ['data:image/png;base64,AAAA'] })
    expect(r.url).toBe('https://api.example.com/v1/images/edits')
    expect(r.payload.images).toEqual([{ image_url: 'data:image/png;base64,AAAA' }])
    expect(r.payload.size).toBe('1024x1024')
  })
  it('jpeg 才传 output_compression', () => {
    const png = client.buildRequest({ prompt: 'x', size: 'auto', quality: 'auto', model: 'm', outputFormat: 'png', compression: 80 })
    expect(png.payload.output_compression).toBeUndefined()
    const jpeg = client.buildRequest({ prompt: 'x', size: 'auto', quality: 'auto', model: 'm', outputFormat: 'jpeg', compression: 80 })
    expect(jpeg.payload.output_compression).toBe(80)
  })
  it('background 非空写入', () => {
    const r = client.buildRequest({ prompt: 'x', size: 'auto', quality: 'auto', model: 'm', outputFormat: 'png', compression: 100, background: 'transparent' })
    expect(r.payload.background).toBe('transparent')
  })
  it('background 为空不写入', () => {
    const r = client.buildRequest({ prompt: 'x', size: 'auto', quality: 'auto', model: 'm', outputFormat: 'png', compression: 100 })
    expect(r.payload.background).toBeUndefined()
  })
})

describe('extractImageApiResult', () => {
  it('抽取 b64_json', () => {
    expect(extractImageApiResult({ data: [{ b64_json: 'QUJDRA==' }] })).toEqual({ type: 'base64', base64: 'QUJDRA==' })
  })
  it('抽取 url', () => {
    expect(extractImageApiResult({ data: [{ url: 'https://x/y.png' }] })).toEqual({ type: 'remote_url', url: 'https://x/y.png' })
  })
  it('无图返回 null', () => {
    expect(extractImageApiResult({ foo: 'bar' })).toBeNull()
  })
  it('null 返回 null', () => {
    expect(extractImageApiResult(null)).toBeNull()
  })
  it('递归抽取 data 字段', () => {
    expect(extractImageApiResult({ data: { b64_json: 'QUJDRA==' } })).toEqual({ type: 'base64', base64: 'QUJDRA==' })
  })
})

describe('resolveImageApiResult', () => {
  it('base64 直接返回', async () => {
    const out = await resolveImageApiResult({ b64_json: 'QUJDRA==' })
    expect(out).toEqual({ type: 'base64', base64: 'QUJDRA==' })
  })
  it('remote_url 下载成功转 base64', async () => {
    const out = await resolveImageApiResult({ url: 'https://x/y.png' }, async () => Buffer.from('hello'))
    expect(out).toEqual({ type: 'base64', base64: Buffer.from('hello').toString('base64') })
  })
  it('下载失败保留 url + downloadError', async () => {
    const out = await resolveImageApiResult({ url: 'https://x/y.png' }, async () => { throw new Error('boom') })
    expect(out).toMatchObject({ type: 'remote_url', url: 'https://x/y.png' })
    expect((out as any).downloadError).toContain('boom')
  })
  it('null payload 返回 null', async () => {
    expect(await resolveImageApiResult(null)).toBeNull()
  })
})
