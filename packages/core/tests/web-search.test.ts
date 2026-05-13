import { describe, it, expect } from 'vitest'
import { webSearchTool } from '../src/tools/web-search.js'

describe('webSearchTool', () => {
  it('has correct definition', () => {
    expect(webSearchTool.definition.name).toBe('web_search')
    expect(webSearchTool.definition.inputSchema.required).toContain('query')
  })

  it('returns error when no API key configured', async () => {
    const result = await webSearchTool.execute(
      { query: 'test query' },
      { cwd: '/tmp' }
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('API key')
  })
})
