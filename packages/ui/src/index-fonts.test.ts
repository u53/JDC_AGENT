import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('UI font stack', () => {
  it('uses the selected VS Code-style editor stack globally', () => {
    const css = readFileSync(resolve(__dirname, 'index.css'), 'utf8')
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8')
    const editorStack = '"SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", "PingFang SC", "Microsoft YaHei UI", monospace'

    expect(css).toContain(`--font-editor: ${editorStack};`)
    expect(css).toContain('--font-serif: var(--font-editor);')
    expect(css).toContain('--font-sans: var(--font-editor);')
    expect(css).toContain('--font-mono: var(--font-editor);')
    expect(html).toContain(`font-family: ${editorStack};`)
  })
})
