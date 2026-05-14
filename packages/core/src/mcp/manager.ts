import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { McpServerConfig, McpServerState, McpToolInfo, McpConnectionStatus } from './types.js'

interface ConnectedServer {
  name: string
  config: McpServerConfig
  client: Client | null
  transport: unknown
  tools: McpToolInfo[]
  status: McpConnectionStatus
  error?: string
  instructions?: string
}

export class McpManager {
  private servers = new Map<string, ConnectedServer>()
  private onStateChange?: () => void

  constructor(onStateChange?: () => void) {
    this.onStateChange = onStateChange
  }

  async loadConfig(configs: Record<string, McpServerConfig>): Promise<void> {
    for (const [name, config] of Object.entries(configs)) {
      if (config.disabled) {
        this.servers.set(name, {
          name, config, client: null, transport: null,
          tools: [], status: 'disabled',
        })
        continue
      }
      await this.connectServer(name, config)
    }
  }

  async connectServer(name: string, config: McpServerConfig): Promise<void> {
    const existing = this.servers.get(name)
    if (existing?.status === 'connected') {
      await this.disconnectServer(name)
    }

    this.servers.set(name, {
      name, config, client: null, transport: null,
      tools: [], status: 'connecting',
    })
    this.onStateChange?.()

    try {
      const transport = this.createTransport(config)
      const client = new Client({ name: 'jdcagnet', version: '0.0.1' }, { capabilities: {} })
      await client.connect(transport)

      const toolsResult = await client.listTools()
      const tools: McpToolInfo[] = (toolsResult.tools || []).map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
      }))

      // Extract instructions from server capabilities if available
      const capabilities = client.getServerCapabilities?.() as Record<string, unknown> | undefined
      const instructions = (capabilities as any)?.instructions as string | undefined

      this.servers.set(name, { name, config, client, transport, tools, status: 'connected', instructions })
      this.onStateChange?.()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      this.servers.set(name, {
        name, config, client: null, transport: null,
        tools: [], status: 'failed', error: message,
      })
      this.onStateChange?.()
    }
  }

  async disconnectServer(name: string): Promise<void> {
    const server = this.servers.get(name)
    if (!server || !server.client) return
    try { await server.client.close() } catch { /* ignore */ }
    server.status = 'disconnected'
    server.tools = []
    this.onStateChange?.()
  }

  async reconnectServer(name: string): Promise<void> {
    const server = this.servers.get(name)
    if (!server) return
    await this.connectServer(name, server.config)
  }

  getServerStates(): McpServerState[] {
    return Array.from(this.servers.values()).map(s => ({
      name: s.name,
      config: s.config,
      status: s.status,
      error: s.error,
      tools: s.tools,
      instructions: s.instructions,
    }))
  }

  getTools(): McpToolInfo[] {
    const tools: McpToolInfo[] = []
    for (const server of this.servers.values()) {
      if (server.status === 'connected') {
        for (const tool of server.tools) {
          tools.push({ ...tool, name: `mcp__${server.name}__${tool.name}` })
        }
      }
    }
    return tools
  }

  async callTool(fullName: string, args: Record<string, unknown>): Promise<{ content: string; isError?: boolean }> {
    const parts = fullName.split('__')
    if (parts.length < 3 || parts[0] !== 'mcp') {
      return { content: `Invalid MCP tool name: ${fullName}`, isError: true }
    }
    const serverName = parts[1]
    const toolName = parts.slice(2).join('__')
    const server = this.servers.get(serverName)
    if (!server || server.status !== 'connected') {
      return { content: `MCP server "${serverName}" is not connected`, isError: true }
    }
    try {
      const result = await server.client!.callTool({ name: toolName, arguments: args })
      const text = (result.content as Array<{ type: string; text?: string }>)
        ?.map(c => c.type === 'text' ? c.text : JSON.stringify(c))
        .join('\n') || ''
      return { content: text, isError: result.isError as boolean | undefined }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { content: `MCP tool error: ${message}`, isError: true }
    }
  }

  async listResources(serverName?: string): Promise<{ uri: string; name: string; description?: string; mimeType?: string; server: string }[]> {
    const results: { uri: string; name: string; description?: string; mimeType?: string; server: string }[] = []
    const targets = serverName
      ? [this.servers.get(serverName)].filter(Boolean)
      : Array.from(this.servers.values()).filter(s => s.status === 'connected')

    for (const server of targets) {
      if (!server || server.status !== 'connected' || !server.client) continue
      try {
        const res = await server.client.listResources()
        for (const r of res.resources || []) {
          results.push({ uri: r.uri, name: r.name, description: r.description, mimeType: r.mimeType, server: server.name })
        }
      } catch { /* ignore */ }
    }
    return results
  }

  async readResource(serverName: string, uri: string): Promise<{ content: string; mimeType?: string }> {
    const server = this.servers.get(serverName)
    if (!server || server.status !== 'connected' || !server.client) {
      throw new Error(`MCP server "${serverName}" is not connected`)
    }
    const result = await server.client.readResource({ uri })
    const content = (result.contents || [])
      .map((c) => ('text' in c ? c.text : ''))
      .join('\n')
    return { content, mimeType: result.contents?.[0]?.mimeType }
  }

  async close(): Promise<void> {
    for (const [name] of this.servers) {
      await this.disconnectServer(name)
    }
    this.servers.clear()
  }

  private createTransport(config: McpServerConfig) {
    if (config.transport === 'stdio') {
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...(config.env || {}) } as Record<string, string>,
      })
    } else {
      return new SSEClientTransport(new URL(config.url))
    }
  }
}
