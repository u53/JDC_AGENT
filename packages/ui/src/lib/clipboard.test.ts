import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyToClipboard } from './clipboard'

describe('copyToClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('awaits the Electron clipboard bridge when available', async () => {
    const writeClipboard = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { electronAPI: { writeClipboard } })

    await copyToClipboard('hello')

    expect(writeClipboard).toHaveBeenCalledWith('hello')
  })

  it('uses the browser clipboard fallback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await copyToClipboard('hello')

    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('reports failure when no clipboard path succeeds', async () => {
    const textarea = { value: '', style: {}, select: vi.fn() }
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('document', {
      createElement: vi.fn(() => textarea),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
      execCommand: vi.fn(() => false),
    })

    await expect(copyToClipboard('hello')).rejects.toThrow('Copy command failed')
  })
})
