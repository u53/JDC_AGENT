import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { McpToolInfo } from './types.js'
import type { McpManager } from './manager.js'

export function createMcpToolHandler(
  serverName: string,
  tool: McpToolInfo,
  manager: McpManager
): ToolHandler {
  const fullName = `mcp__${serverName}__${tool.name}`
  return {
    definition: {
      name: fullName,
      description: `[MCP: ${serverName}] ${tool.description || tool.name}`,
      inputSchema: tool.inputSchema || { type: 'object', properties: {} },
    },
    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const result = await manager.callTool(fullName, input)
      return { content: result.content, isError: result.isError }
    },
  }
}
