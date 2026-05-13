import { describe, it, expect } from 'vitest'
import { estimateTokens } from '../src/token-estimation.js'
import type { Message } from '../src/types.js'

describe('token estimation', () => {
  it('estimates tokens from text messages', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: [{ type: 'text', text: 'Hello world' }], timestamp: 0 },
      { id: '2', role: 'assistant', content: [{ type: 'text', text: 'Hi there, how can I help?' }], timestamp: 0 },
    ]
    const tokens = estimateTokens(messages)
    expect(tokens).toBeGreaterThan(5)
    expect(tokens).toBeLessThan(50)
  })

  it('handles tool use blocks', () => {
    const messages: Message[] = [
      { id: '1', role: 'assistant', content: [{ type: 'tool_use', id: 'tc1', name: 'bash', input: { command: 'ls -la /tmp' } }], timestamp: 0 },
    ]
    const tokens = estimateTokens(messages)
    expect(tokens).toBeGreaterThan(0)
  })

  it('handles image blocks', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } }], timestamp: 0 },
    ]
    const tokens = estimateTokens(messages)
    expect(tokens).toBeGreaterThan(200) // 1000 chars / 3.5
  })
})
