import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('UI font stack', () => {
  it('uses bundled JDC fonts before system fallbacks', () => {
    const css = readFileSync(resolve(__dirname, 'index.css'), 'utf8')

    expect(css).toContain('@fontsource-variable/geist')
    expect(css).toContain('@fontsource-variable/noto-sans-sc')
    expect(css).toContain('@fontsource-variable/jetbrains-mono')
    expect(css).toContain('--font-sans: "Geist Variable"')
    expect(css).toContain('"Noto Sans SC Variable"')
    expect(css).toContain('--font-mono: "JetBrains Mono Variable"')
  })
})
