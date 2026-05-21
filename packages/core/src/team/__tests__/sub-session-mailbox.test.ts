import { describe, it, expect } from 'vitest'
import { formatExternalMessages } from '../../sub-session.js'

describe('formatExternalMessages', () => {
  it('formats basic messages', () => {
    const msgs = [
      { from: 'manager', content: 'Hurry up', priority: 'high' },
      { from: 'user', content: 'Focus on core only', priority: 'normal' },
    ]
    const text = formatExternalMessages(msgs)
    expect(text).toContain('[manager]')
    expect(text).toContain('Hurry up')
    expect(text).toContain('[user]')
    expect(text).toContain('Focus on core only')
  })

  it('adds URGENT prefix for urgent priority', () => {
    const msgs = [{ from: 'user', content: 'Stop now', priority: 'urgent' }]
    const text = formatExternalMessages(msgs)
    expect(text).toContain('[URGENT]')
    expect(text).toContain('Stop now')
  })

  it('includes intent tag when present', () => {
    const msgs = [{ from: 'manager', content: 'Wrap it up', intent: 'wrap_up', priority: 'high' }]
    const text = formatExternalMessages(msgs)
    expect(text).toContain('(wrap_up)')
  })

  it('handles empty array', () => {
    expect(formatExternalMessages([])).toBe('')
  })
})
