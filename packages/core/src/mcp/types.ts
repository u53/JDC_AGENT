export type McpTransportType = 'stdio' | 'sse'

export interface McpStdioConfig {
  transport: 'stdio'
  command: string
  args: string[]
  env?: Record<string, string>
  disabled?: boolean
}

export interface McpSseConfig {
  transport: 'sse'
  url: string
  headers?: Record<string, string>
  disabled?: boolean
}

export type McpServerConfig = McpStdioConfig | McpSseConfig

export type McpConnectionStatus = 'connected' | 'connecting' | 'failed' | 'disconnected' | 'disabled'

export interface McpServerState {
  name: string
  config: McpServerConfig
  status: McpConnectionStatus
  error?: string
  tools: McpToolInfo[]
  instructions?: string  // from server's initialize response
}

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>
}
