import type { McpStdioConfig } from '../mcp/types.js'
import { resolveCodegraphBinary } from './binary.js'

export const CODEGRAPH_SERVER_NAME = 'codegraph'

export function getDefaultCodegraphMcpConfig(): McpStdioConfig | null {
  const bin = resolveCodegraphBinary()
  if (!bin) return null
  return {
    transport: 'stdio',
    command: bin,
    args: ['serve', '--mcp'],
  }
}
