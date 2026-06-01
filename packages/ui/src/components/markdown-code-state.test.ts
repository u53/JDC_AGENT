import { afterEach, describe, expect, it } from 'vitest'
import {
  clearRememberedCodeExpansions,
  createMarkdownCodeBlockKey,
  getRememberedCodeExpansion,
  rememberCodeExpansion,
} from './markdown-code-state'

describe('markdown code expansion state', () => {
  afterEach(() => {
    clearRememberedCodeExpansions()
  })

  it('restores expansion for the same code block key after remount', () => {
    const key = createMarkdownCodeBlockKey('json', '{"same": true}')

    expect(getRememberedCodeExpansion(key, false)).toBe(false)

    rememberCodeExpansion(key, true)

    expect(getRememberedCodeExpansion(key, false)).toBe(true)
  })

  it('keeps different code blocks independent', () => {
    const first = createMarkdownCodeBlockKey('json', '{"same": true}')
    const second = createMarkdownCodeBlockKey('json', '{"same": false}')

    rememberCodeExpansion(first, true)

    expect(getRememberedCodeExpansion(second, false)).toBe(false)
  })
})
