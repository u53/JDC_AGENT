import { describe, expect, it } from 'vitest'
import {
  COMPOSER_IME_ENTER_SUPPRESSION_MS,
  resizeComposerTextarea,
  shouldDelegateKeyToSlashMenu,
  shouldIgnoreKeyDownForIme,
} from './Composer'

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

describe('shouldDelegateKeyToSlashMenu', () => {
  it('does not delegate Enter when the slash menu has no selectable items', () => {
    expect(shouldDelegateKeyToSlashMenu('Enter', true, 0)).toBe(false)
  })
})

describe('shouldIgnoreKeyDownForIme', () => {
  it('ignores the Enter key that immediately follows macOS IME composition end', () => {
    expect(shouldIgnoreKeyDownForIme({
      key: 'Enter',
      isComposing: false,
      nativeIsComposing: false,
      nativeKeyCode: 13,
      lastCompositionEndAt: 1000,
      now: 1000 + COMPOSER_IME_ENTER_SUPPRESSION_MS - 1,
    })).toBe(true)
  })

  it('allows Enter after the IME suppression window has elapsed', () => {
    expect(shouldIgnoreKeyDownForIme({
      key: 'Enter',
      isComposing: false,
      nativeIsComposing: false,
      nativeKeyCode: 13,
      lastCompositionEndAt: 1000,
      now: 1000 + COMPOSER_IME_ENTER_SUPPRESSION_MS + 1,
    })).toBe(false)
  })
})
