import { describe, expect, it } from 'vitest'
import { shouldShowContextInspector } from './context-inspector-visibility'

describe('context inspector visibility', () => {
  it('hides the JDC Context Engine inspector in production by default', () => {
    expect(shouldShowContextInspector({ DEV: false, PROD: true })).toBe(false)
  })

  it('shows the JDC Context Engine inspector during development', () => {
    expect(shouldShowContextInspector({ DEV: true, PROD: false })).toBe(true)
  })

  it('allows production diagnostics only behind an explicit build flag', () => {
    expect(shouldShowContextInspector({ DEV: false, PROD: true, VITE_JDC_CONTEXT_INSPECTOR: 'true' })).toBe(true)
    expect(shouldShowContextInspector({ DEV: true, PROD: false, VITE_JDC_CONTEXT_INSPECTOR: 'false' })).toBe(false)
  })
})
