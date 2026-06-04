import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CompactStatusCard } from './CompactStatusCard'

describe('CompactStatusCard', () => {
  it('renders a dedicated Chinese compacting card instead of generic processing copy', () => {
    const html = renderToStaticMarkup(<CompactStatusCard status="running" />)

    expect(html).toContain('正在压缩上下文')
    expect(html).toContain('jdc-compact-card')
    expect(html).not.toContain('PROCESSING')
  })

  it('renders compact completion as a structured status card', () => {
    const html = renderToStaticMarkup(
      <CompactStatusCard
        status="complete"
        originalCount={38}
        summarizedCount={31}
        keptRecent={7}
      />,
    )

    expect(html).toContain('上下文已压缩')
    expect(html).toContain('已摘要 31 条')
    expect(html).toContain('保留最近 7 条')
    expect(html).not.toContain('Context compressed')
  })
})
