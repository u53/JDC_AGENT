import { describe, it, expect, vi, afterEach } from 'vitest'

describe('getDefaultCodegraphMcpConfig', () => {
  afterEach(() => vi.resetModules())

  it('returns null when binary is not available', async () => {
    vi.doMock('../binary.js', () => ({
      resolveCodegraphBinary: () => null,
      isCodegraphAvailable: () => false,
    }))
    const { getDefaultCodegraphMcpConfig, CODEGRAPH_SERVER_NAME } = await import('../mcp-default.js')
    expect(getDefaultCodegraphMcpConfig()).toBeNull()
    expect(CODEGRAPH_SERVER_NAME).toBe('codegraph')
  })

  it('returns stdio config when binary exists', async () => {
    vi.doMock('../binary.js', () => ({
      resolveCodegraphBinary: () => '/opt/codegraph/bin/codegraph',
      isCodegraphAvailable: () => true,
    }))
    const { getDefaultCodegraphMcpConfig } = await import('../mcp-default.js')
    expect(getDefaultCodegraphMcpConfig()).toEqual({
      transport: 'stdio',
      command: '/opt/codegraph/bin/codegraph',
      args: ['serve', '--mcp'],
    })
  })
})
