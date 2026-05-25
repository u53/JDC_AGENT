import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { McpManager } from '../mcp/manager.js'

export function createListMcpResourcesTool(manager: McpManager): ToolHandler {
  return {
    definition: {
      name: 'list_mcp_resources',
      description:
        'List available resources from connected MCP servers. Use this to discover remote resources ' +
        '(database schemas, API specs, documentation) that are not available as local files. ' +
        'Optionally filter by server name.',
      inputSchema: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'Optional server name to filter by' },
        },
      },
    },
    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const serverName = input.server as string | undefined
      const resources = await manager.listResources(serverName)
      return { content: JSON.stringify(resources, null, 2) }
    },
  }
}
