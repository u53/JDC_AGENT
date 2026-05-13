import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { McpManager } from '../mcp/manager.js'

export function createReadMcpResourceTool(manager: McpManager): ToolHandler {
  return {
    definition: {
      name: 'read_mcp_resource',
      description: 'Read a specific resource from an MCP server by URI.',
      inputSchema: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'The MCP server name' },
          uri: { type: 'string', description: 'The resource URI to read' },
        },
        required: ['server', 'uri'],
      },
    },
    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const server = input.server as string
      const uri = input.uri as string
      if (!server || !uri) {
        return { content: 'Both server and uri are required', isError: true }
      }
      try {
        const result = await manager.readResource(server, uri)
        return { content: result.content }
      } catch (err: any) {
        return { content: err.message, isError: true }
      }
    },
  }
}
