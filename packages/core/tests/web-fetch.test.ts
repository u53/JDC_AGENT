import { describe, it, expect } from 'vitest'
import { webFetchTool } from '../src/tools/web-fetch.js'

describe('webFetchTool', () => {
  it('has correct definition', () => {
    expect(webFetchTool.definition.name).toBe('web_fetch')
    expect(webFetchTool.definition.inputSchema.required).toContain('url')
    expect(webFetchTool.definition.inputSchema.required).toContain('prompt')
  })

  it('returns error for invalid URL', async () => {
    const result = await webFetchTool.execute(
      { url: 'not-a-url', prompt: 'summarize' },
      { cwd: '/tmp' },
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('invalid URL')
  })

  it('returns error for non-existent domain', async () => {
    const result = await webFetchTool.execute(
      { url: 'http://this-domain-does-not-exist-xyz123.com', prompt: 'test' },
      { cwd: '/tmp' },
    )
    expect(result.isError).toBe(true)
  }, 35000)
})
