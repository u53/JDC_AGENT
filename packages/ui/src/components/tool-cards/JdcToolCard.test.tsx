import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { JdcToolCard } from './JdcToolCard'

describe('JdcToolCard', () => {
  it('renders JDC code tools as a non-expandable black-box status card', () => {
    const html = renderToStaticMarkup(
      <JdcToolCard
        event={{
          type: 'complete',
          toolName: 'JdcContext',
          toolUseId: 'tool-jdc-1',
          input: { task: 'JDC Context Engine 的 engine.ts 是如何工作的' },
          result: {
            content: 'LARGE RAW RESULT\npackages/core/src/context-engine/engine.ts\nhandleMessage\n'.repeat(30),
            isError: false,
          },
        } as any}
      />,
    )

    expect(html).toContain('JDC Context Engine')
    expect(html).toContain('已理解项目')
    expect(html).toContain('上下文检索')
    expect(html).toContain('jdc-engine-robot')
    expect(html).toContain('jdc-engine-robot-eyes')
    expect(html).toContain('--jdc-robot-eye-x')
    expect(html).not.toContain('jdc-engine-signal')
    expect(html).not.toContain('aria-expanded')
    expect(html).not.toContain('复制结果')
    expect(html).not.toContain('jdc-engine-result')
    expect(html).not.toContain('LARGE RAW RESULT')
    expect(html).not.toContain('packages/core/src/context-engine/engine.ts')
  })

  it('keeps the robot active on completed cards while reserving the signal dots for running cards', () => {
    const doneHtml = renderToStaticMarkup(
      <JdcToolCard
        event={{
          type: 'complete',
          toolName: 'JdcSearch',
          toolUseId: 'tool-jdc-done',
          input: { query: 'memorySearch' },
          result: { content: '- function memorySearch — src/a.ts:1', isError: false },
        } as any}
      />,
    )
    const runningHtml = renderToStaticMarkup(
      <JdcToolCard
        event={{
          type: 'progress',
          toolName: 'JdcSearch',
          toolUseId: 'tool-jdc-running',
          input: { query: 'memorySearch' },
          result: { content: '', isError: false },
        } as any}
      />,
    )

    expect(doneHtml).not.toContain('jdc-engine-signal')
    expect(doneHtml).toContain('jdc-engine-robot is-live')
    expect(runningHtml).toContain('jdc-engine-signal is-live')
    expect(runningHtml).toContain('jdc-engine-robot is-live')
  })

  it('keeps running JDC cards compact without exposing partial raw output', () => {
    const html = renderToStaticMarkup(
      <JdcToolCard
        event={{
          type: 'progress',
          toolName: 'JdcSearch',
          toolUseId: 'tool-jdc-2',
          input: { query: 'handleMessage' },
          result: {
            content: 'PARTIAL RAW RESULT handleMessage',
            isError: false,
          },
        } as any}
      />,
    )

    expect(html).toContain('正在理解项目')
    expect(html).toContain('符号搜索')
    expect(html).toContain('data-status="running"')
    expect(html).toContain('jdc-engine-signal')
    expect(html).not.toContain('PARTIAL RAW RESULT')
    expect(html).not.toContain('aria-expanded')
  })
})
