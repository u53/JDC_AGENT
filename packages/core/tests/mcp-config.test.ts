import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadMcpConfig, saveMcpConfig, mergeConfigs } from '../src/mcp/config.js'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TEST_DIR = path.join(os.tmpdir(), 'jdcagnet-mcp-test-' + Date.now())
const TEST_CWD = path.join(TEST_DIR, 'project')

beforeEach(() => {
  mkdirSync(path.join(TEST_CWD, '.jdcagnet'), { recursive: true })
})

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('loadMcpConfig', () => {
  it('returns empty when no config files exist', () => {
    const config = loadMcpConfig('/nonexistent', '/nonexistent-global')
    expect(config).toEqual({})
  })

  it('loads global config', () => {
    const globalPath = path.join(TEST_DIR, 'global-mcp-servers.json')
    writeFileSync(globalPath, JSON.stringify({
      mcpServers: {
        filesystem: { transport: 'stdio', command: 'npx', args: ['server-fs'] }
      }
    }))
    const config = loadMcpConfig('/nonexistent', globalPath)
    expect(config.filesystem).toBeDefined()
    expect(config.filesystem.transport).toBe('stdio')
  })

  it('merges project config over global', () => {
    const globalPath = path.join(TEST_DIR, 'global-mcp-servers.json')
    writeFileSync(globalPath, JSON.stringify({
      mcpServers: {
        filesystem: { transport: 'stdio', command: 'npx', args: ['server-fs'] },
        other: { transport: 'sse', url: 'http://example.com/sse' }
      }
    }))
    const projectPath = path.join(TEST_CWD, '.jdcagnet', 'mcp-servers.json')
    writeFileSync(projectPath, JSON.stringify({
      mcpServers: {
        filesystem: { transport: 'stdio', command: 'node', args: ['custom.js'] }
      }
    }))
    const config = loadMcpConfig(TEST_CWD, globalPath)
    expect(config.filesystem.command).toBe('node')
    expect(config.other).toBeDefined()
  })
})

describe('mergeConfigs', () => {
  it('project overrides global for same server name', () => {
    const merged = mergeConfigs(
      { a: { transport: 'stdio', command: 'x', args: [] } },
      { a: { transport: 'stdio', command: 'y', args: [] } }
    )
    expect(merged.a.command).toBe('y')
  })
})
