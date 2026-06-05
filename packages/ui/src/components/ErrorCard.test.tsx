import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ErrorCard } from './ErrorCard'

describe('ErrorCard', () => {
  it('shows automatic retry progress and a cancel action while retrying', () => {
    const html = renderToStaticMarkup(
      <ErrorCard
        message="upstream overloaded"
        category="overloaded"
        retrying={true}
        retryAttempt={1}
        retryMaxRetries={10}
        retryIn={9000}
        onRetry={() => {}}
        onDismiss={() => {}}
        onCancel={() => {}}
      />,
    )

    expect(html).toContain('Retrying 1/10')
    expect(html).toContain('next attempt in 9s')
    expect(html).toContain('Cancel')
    expect(html).not.toContain('Retry</button>')
    expect(html).not.toContain('Dismiss')
  })

  it('shows manual retry only after automatic retries are exhausted', () => {
    const html = renderToStaticMarkup(
      <ErrorCard
        message="final failure"
        category="network"
        retrying={false}
        onRetry={() => {}}
        onDismiss={() => {}}
        onCancel={() => {}}
      />,
    )

    expect(html).toContain('Retry')
    expect(html).toContain('Dismiss')
    expect(html).not.toContain('Cancel')
  })
})
