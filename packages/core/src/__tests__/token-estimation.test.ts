import { describe, it, expect } from 'vitest'
import { estimateTokens } from '../token-estimation.js'
import type { Message } from '../types.js'

function makeMsg(text: string): Message {
  return { id: '1', role: 'user', content: [{ type: 'text', text }], timestamp: 0 }
}

describe('estimateTokens', () => {
  it('estimates English text (~4 chars/token)', () => {
    const tokens = estimateTokens([makeMsg('Hello world this is a test')])
    expect(tokens).toBeGreaterThan(5)
    expect(tokens).toBeLessThan(12)
  })

  it('estimates Chinese text (~1.5 chars/token)', () => {
    const tokens = estimateTokens([makeMsg('你好世界这是一个测试')])
    expect(tokens).toBeGreaterThan(12)
    expect(tokens).toBeLessThan(20)
  })

  it('estimates mixed content', () => {
    const tokens = estimateTokens([makeMsg('Hello 你好 world 世界')])
    expect(tokens).toBeGreaterThan(7)
    expect(tokens).toBeLessThan(15)
  })

  it('handles image blocks', () => {
    const msg: Message = { id: '1', role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } } as any], timestamp: 0 }
    expect(estimateTokens([msg])).toBe(1300)
  })

  it('handles tool_use blocks', () => {
    const msg: Message = { id: '1', role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'file_read', input: { file_path: '/src/index.ts' } }], timestamp: 0 }
    const tokens = estimateTokens([msg])
    expect(tokens).toBeGreaterThan(5)
  })
})
