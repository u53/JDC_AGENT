import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TaskToolCard } from './TaskToolCard'

describe('TaskToolCard', () => {
  it('does not render long-value hover panels inside the clipped tool card', () => {
    const longSubject = '这是一个很长很长的任务标题，用来确认悬浮提示不会被工具卡片自己的 overflow 环境裁剪。'.repeat(4)
    const html = renderToStaticMarkup(
      <TaskToolCard
        name="TaskCreate"
        input={{ subject: longSubject }}
        result={{ content: 'created', is_error: false }}
      />,
    )

    expect(html).toContain('title=')
    expect(html).not.toContain('group-hover:block')
    expect(html).not.toContain('bottom-full')
  })
})
