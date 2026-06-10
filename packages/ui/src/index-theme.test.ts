import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('JDC theme palettes', () => {
  it('keeps the softened JDC dark palette and adds a JDC light palette', () => {
    const css = readFileSync(resolve(__dirname, 'index.css'), 'utf8')

    expect(css).toContain('--bg: #07111d')
    expect(css).toContain('--surface: #0b1624')
    expect(css).toContain('--text: #e8eef6')
    expect(css).toContain('--accent: #34d67a')
    expect(css).toContain('[data-theme="light"]')
    expect(css).toContain('--bg: #f6f8fb')
    expect(css).toContain('--surface: #ffffff')
    expect(css).toContain('--text: #172033')
    expect(css).toContain('--accent: #1f9d5a')
    expect(css).not.toContain('--bg: #020617')
    expect(css).not.toContain('--text: #f8fafc')
  })
})
