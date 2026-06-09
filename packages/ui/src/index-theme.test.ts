import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('JDC dark palette', () => {
  it('uses a softened dark palette instead of harsh black and white contrast', () => {
    const css = readFileSync(resolve(__dirname, 'index.css'), 'utf8')

    expect(css).toContain('--bg: #07111d')
    expect(css).toContain('--surface: #0b1624')
    expect(css).toContain('--text: #e8eef6')
    expect(css).toContain('--accent: #34d67a')
    expect(css).not.toContain('--bg: #020617')
    expect(css).not.toContain('--text: #f8fafc')
  })
})
