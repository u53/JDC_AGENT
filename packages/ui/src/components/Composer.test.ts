import { describe, expect, it } from 'vitest'
import { resizeComposerTextarea } from './Composer'

describe('resizeComposerTextarea', () => {
  it('shrinks a previously expanded textarea back to its single-line height', () => {
    const textarea = {
      scrollHeight: 44,
      style: {
        height: '200px',
        overflowY: 'auto',
      },
    }

    resizeComposerTextarea(textarea)

    expect(textarea.style.height).toBe('44px')
    expect(textarea.style.overflowY).toBe('hidden')
  })
})
