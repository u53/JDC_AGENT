import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownRenderer } from './MarkdownRenderer'

describe('MarkdownRenderer', () => {
  it('renders fenced code blocks collapsed by default', () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer content={'```json\n{"long": true}\n```'} />,
    )

    expect(html).toContain('data-expanded="false"')
    expect(html).toContain('1 line')
    expect(html).not.toContain('<pre')
  })

  it('preserves syntax highlighting inside fenced code blocks', () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer content={'```ts\nconst answer = \"forty two\"\n```'} defaultCodeExpanded />,
    )

    expect(html).toContain('hljs-keyword')
    expect(html).toContain('hljs-string')
    expect(html).toContain('const')
  })
})
