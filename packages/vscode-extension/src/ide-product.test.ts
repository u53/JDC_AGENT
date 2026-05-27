import { describe, expect, it } from 'vitest'
import { detectIdeProduct } from './ide-product'

describe('detectIdeProduct', () => {
  it('detects Cursor from appName', () => {
    expect(detectIdeProduct('Cursor', 'cursor')).toMatchObject({
      ideId: 'cursor',
      ideName: 'Cursor',
    })
  })

  it('detects Windsurf from uriScheme', () => {
    expect(detectIdeProduct('Code', 'windsurf')).toMatchObject({
      ideId: 'windsurf',
      ideName: 'Windsurf',
    })
  })

  it('falls back to VS Code', () => {
    expect(detectIdeProduct('Visual Studio Code', 'vscode')).toMatchObject({
      ideId: 'vscode',
      ideName: 'VS Code',
    })
  })
})
