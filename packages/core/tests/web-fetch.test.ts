import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadAppConfig } from '../src/config.js'
import { webFetchTool } from '../src/tools/web-fetch.js'

vi.mock('../src/config.js', () => ({
  loadAppConfig: vi.fn(() => ({ webSearch: {} })),
}))

describe('webFetchTool', () => {
  beforeEach(() => {
    vi.mocked(loadAppConfig).mockReturnValue({ webSearch: {} } as any)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('has correct definition', () => {
    expect(webFetchTool.definition.name).toBe('WebFetch')
    expect(webFetchTool.definition.inputSchema.required).toContain('url')
    expect(webFetchTool.definition.inputSchema.required).toContain('prompt')
    expect(webFetchTool.definition.description).toContain('WebSearch snippets are not evidence')
    expect(webFetchTool.definition.description).toContain('configured WebSearch proxy')
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

  it('uses the configured web proxy through an undici dispatcher', async () => {
    vi.mocked(loadAppConfig).mockReturnValue({
      webSearch: { proxy: 'http://127.0.0.1:7890' },
    } as any)
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => '<html><head><title>Example</title></head><body><main><h1>Example</h1><p>Fetched content.</p></main></body></html>',
    })) as any
    vi.stubGlobal('fetch', fetchMock)

    const result = await webFetchTool.execute(
      { url: 'https://example.com', prompt: 'summarize' },
      { cwd: '/tmp' },
    )

    expect(result.isError).not.toBe(true)
    expect((fetchMock.mock.calls[0][1] as any).dispatcher).toBeDefined()
    expect((fetchMock.mock.calls[0][1] as any).agent).toBeUndefined()
  })
})
