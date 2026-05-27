import { describe, expect, it } from 'vitest'
import { isSameOrChildPath } from './path-match'

describe('isSameOrChildPath', () => {
  it('matches Windows paths when one side uses forward slashes', () => {
    expect(isSameOrChildPath('D:\\project\\saas\\olympus', 'D:/project/saas/olympus')).toBe(true)
  })

  it('matches child paths on Windows-style paths', () => {
    expect(isSameOrChildPath('D:\\project\\saas\\olympus\\src', 'D:/project/saas/olympus')).toBe(true)
  })

  it('does not match sibling paths with the same prefix', () => {
    expect(isSameOrChildPath('D:\\project\\saas\\olympus-old', 'D:/project/saas/olympus')).toBe(false)
  })
})
