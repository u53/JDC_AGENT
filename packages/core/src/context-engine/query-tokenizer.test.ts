import { describe, expect, it } from 'vitest'
import { tokenizeQueryText } from './query-tokenizer.js'

describe('tokenizeQueryText', () => {
  it('preserves mixed Chinese, path, filename, and symbol terms independently', () => {
    const tokens = tokenizeQueryText('修复 packages/core/src/session.ts 的 backgroundTasks 逻辑')

    expect(tokens).toContainEqual({ value: 'packages/core/src/session.ts', kind: 'path', weight: 6 })
    expect(tokens).toContainEqual({ value: 'session.ts', kind: 'path', weight: 6 })
    expect(tokens).toContainEqual({ value: 'backgroundTasks', kind: 'symbol', weight: 5 })
    expect(tokens.some((token) => token.kind === 'cjk' && token.value === '修复')).toBe(true)
  })

  it('keeps quoted phrases and short CJK input alongside mixed symbols', () => {
    const tokens = tokenizeQueryText('查 PM worker 的 contextRefreshPayload 和 "tool result metadata"')

    expect(tokens).toContainEqual({ value: 'contextRefreshPayload', kind: 'symbol', weight: 5 })
    expect(tokens).toContainEqual({ value: 'tool result metadata', kind: 'quoted', weight: 4 })
    expect(tokens.some((token) => token.kind === 'cjk' && token.value === '查')).toBe(true)
  })
})
