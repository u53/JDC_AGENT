import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConversationTurn } from './ConversationTurn'

describe('ConversationTurn compact rendering', () => {
  it('shows active tool calls without results as waiting instead of empty done cards', () => {
    const html = renderToStaticMarkup(
      <ConversationTurn
        userContent={[{ type: 'text', text: 'fetch latest AI news' }]}
        isActive
        assistantMessages={[
          {
            message: {
              id: 'assistant-tool-use',
              role: 'assistant',
              content: [{
                type: 'tool_use',
                id: 'tool-web-fetch-1',
                name: 'WebFetch',
                input: {
                  url: 'https://example.com/news',
                  prompt: 'Extract the latest AI-related headlines.',
                },
              }],
              timestamp: 1,
            } as any,
          },
        ]}
      />,
    )

    expect(html).toContain('Waiting for remote response...')
    expect(html).not.toContain('No result content.')
  })

  it('renders compact notice messages as compact cards instead of raw assistant text', () => {
    const html = renderToStaticMarkup(
      <ConversationTurn
        userContent={[{ type: 'text', text: '继续' }]}
        assistantMessages={[
          {
            message: {
              id: 'compact-notice-1',
              role: 'assistant',
              content: [{
                type: 'text',
                text: `__JDC_COMPACT__${JSON.stringify({
                  status: 'complete',
                  originalCount: 38,
                  summarizedCount: 31,
                  keptRecent: 7,
                })}`,
              }],
              timestamp: 1,
            },
          },
        ]}
      />,
    )

    expect(html).toContain('上下文已压缩')
    expect(html).toContain('已摘要 31 条')
    expect(html).not.toContain('__JDC_COMPACT__')
    expect(html).not.toContain('Context compressed')
  })

  it('renders compacted history summary messages as a collapsed compact summary card', () => {
    const html = renderToStaticMarkup(
      <ConversationTurn
        userContent={[{
          type: 'text',
          text: '[Context from prior conversation - this summary replaces earlier messages.]\n\n## 1. Primary Request and Intent\nKeep working from verified state.',
        }]}
        assistantMessages={[]}
      />,
    )

    expect(html).toContain('压缩摘要')
    expect(html).toContain('已隐藏早期长对话')
    expect(html).not.toContain('[Context from prior conversation')
  })
})
