import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadAppConfig } from '../src/config.js'
import { webSearchTool } from '../src/tools/web-search.js'

vi.mock('../src/config.js', () => ({
  loadAppConfig: vi.fn(() => ({ webSearch: {} })),
}))

describe('webSearchTool', () => {
  beforeEach(() => {
    vi.mocked(loadAppConfig).mockReturnValue({ webSearch: {} } as any)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('has correct definition', () => {
    expect(webSearchTool.definition.name).toBe('WebSearch')
    expect(webSearchTool.definition.inputSchema.required).toContain('query')
    expect(webSearchTool.definition.description).toContain('Use count=8')
    expect(webSearchTool.definition.description).toContain('Snippets are NOT evidence')
    expect(webSearchTool.definition.description).toContain('WebFetch on the relevant result URLs')
    expect(webSearchTool.definition.description).not.toContain('1-3')
  })

  it('returns error when no API key configured', async () => {
    const result = await webSearchTool.execute(
      { query: 'test query' },
      { cwd: '/tmp' }
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('API key')
  })

  it('raises tiny requested result counts to at least five', async () => {
    vi.mocked(loadAppConfig).mockReturnValue({
      webSearch: { provider: 'brave', braveApiKey: 'test-key' },
    } as any)
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ web: { results: [] } }),
    })) as any
    vi.stubGlobal('fetch', fetchMock)

    await webSearchTool.execute(
      { query: 'test query', count: 3 },
      { cwd: '/tmp' }
    )

    expect(String(fetchMock.mock.calls[0][0])).toContain('count=5')
  })

  it('uses eight results by default and warns that snippets are not evidence', async () => {
    vi.mocked(loadAppConfig).mockReturnValue({
      webSearch: { provider: 'brave', braveApiKey: 'test-key' },
    } as any)
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ web: { results: [{ title: 'Example', url: 'https://example.com', description: 'Short snippet' }] } }),
    })) as any
    vi.stubGlobal('fetch', fetchMock)

    const result = await webSearchTool.execute(
      { query: 'test query' },
      { cwd: '/tmp' }
    )

    expect(String(fetchMock.mock.calls[0][0])).toContain('count=8')
    expect(result.content).toContain('https://example.com')
    expect(result.content).toContain('snippets, not evidence')
    expect(result.content).toContain('use WebFetch')
  })

  it('caps broad requested result counts at ten', async () => {
    vi.mocked(loadAppConfig).mockReturnValue({
      webSearch: { provider: 'brave', braveApiKey: 'test-key' },
    } as any)
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ web: { results: [] } }),
    })) as any
    vi.stubGlobal('fetch', fetchMock)

    await webSearchTool.execute(
      { query: 'test query', count: 50 },
      { cwd: '/tmp' }
    )

    expect(String(fetchMock.mock.calls[0][0])).toContain('count=10')
  })
})
