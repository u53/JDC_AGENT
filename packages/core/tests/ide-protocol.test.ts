import { describe, it, expect } from 'vitest'
import { JsonRpcProtocol } from '../src/ide/protocol.js'

describe('JsonRpcProtocol', () => {
  it('encodes a request', () => {
    const proto = new JsonRpcProtocol()
    const { message, id } = proto.createRequest('openFile', { filePath: '/test.ts', line: 1 })
    const parsed = JSON.parse(message)
    expect(parsed.jsonrpc).toBe('2.0')
    expect(parsed.id).toBe(id)
    expect(parsed.method).toBe('openFile')
    expect(parsed.params.filePath).toBe('/test.ts')
  })

  it('encodes a notification (no id)', () => {
    const proto = new JsonRpcProtocol()
    const message = proto.createNotification('selection_changed', { text: 'hello' })
    const parsed = JSON.parse(message)
    expect(parsed.jsonrpc).toBe('2.0')
    expect(parsed.method).toBe('selection_changed')
    expect(parsed.id).toBeUndefined()
  })

  it('parses a response and resolves pending request', async () => {
    const proto = new JsonRpcProtocol()
    const { id } = proto.createRequest('openFile', { filePath: '/test.ts' })
    const promise = proto.waitForResponse(id)
    proto.handleMessage(JSON.stringify({ jsonrpc: '2.0', id, result: { success: true } }))
    await expect(promise).resolves.toEqual({ success: true })
  })

  it('parses an error response and rejects', async () => {
    const proto = new JsonRpcProtocol()
    const { id } = proto.createRequest('openFile', { filePath: '/test.ts' })
    const promise = proto.waitForResponse(id)
    proto.handleMessage(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -1, message: 'fail' } }))
    await expect(promise).rejects.toThrow('fail')
  })

  it('parses a notification and calls handler', () => {
    const proto = new JsonRpcProtocol()
    const received: any[] = []
    proto.onNotification('selection_changed', (params) => received.push(params))
    proto.handleMessage(JSON.stringify({ jsonrpc: '2.0', method: 'selection_changed', params: { text: 'hi' } }))
    expect(received).toEqual([{ text: 'hi' }])
  })

  it('times out pending requests', async () => {
    const proto = new JsonRpcProtocol()
    const { id } = proto.createRequest('openFile', { filePath: '/test.ts' })
    const promise = proto.waitForResponse(id, 50)
    await expect(promise).rejects.toThrow('timeout')
  })
})
