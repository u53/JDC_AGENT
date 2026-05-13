# JDCAGNET Phase 2B: MCP Integration Design

## Goal

Add full MCP (Model Context Protocol) client support to JDCAGNET, enabling users to connect external MCP servers that provide additional tools, resources, and prompts. This makes JDCAGNET extensible without code changes.

## Architecture

JDCAGNET's MCP integration follows a simplified version of Claude Code's architecture:
- A `McpManager` in `packages/core` handles server lifecycle (connect/disconnect/reconnect)
- Two transports: stdio (local subprocess) and SSE (remote HTTP)
- MCP tools are dynamically registered into the existing `ToolRegistry` with `mcp__<server>__<tool>` naming
- MCP resources exposed via `list_mcp_resources` and `read_mcp_resource` built-in tools
- Configuration stored in `~/.jdcagnet/mcp-servers.json` (global) and `.jdcagnet/mcp-servers.json` (project)
- UI panel in settings for managing server configurations

## Tech Stack

- `@modelcontextprotocol/sdk` — Official MCP SDK (Client, transports)
- Existing: Electron IPC, ToolRegistry, ToolHandler interface

---

## 1. MCP Configuration

### Config File Format

`~/.jdcagnet/mcp-servers.json` (global) and `<project>/.jdcagnet/mcp-servers.json` (project-level):

```json
{
  "mcpServers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/docs"],
      "env": {}
    },
    "remote-api": {
      "transport": "sse",
      "url": "https://mcp.example.com/sse",
      "headers": { "Authorization": "Bearer xxx" }
    }
  }
}
```

### Loading Priority

1. Global config (`~/.jdcagnet/mcp-servers.json`)
2. Project config (`<cwd>/.jdcagnet/mcp-servers.json`) — merges on top, same-name overrides global

---

## 2. MCP Client & Transport

### McpManager Class

Lives in `packages/core/src/mcp/manager.ts`. Responsibilities:
- Load config, create clients for each server
- Track connection state per server (connected / failed / disconnected)
- Expose `getTools()` returning all MCP tool definitions
- Expose `callTool(serverName, toolName, args)` for execution
- Expose `listResources(serverName?)` and `readResource(serverName, uri)`
- Handle reconnection on error
- Graceful shutdown (close all clients on app quit)

### Transports

**Stdio:**
- Spawn subprocess with `command` + `args`
- Pass `env` merged with `process.env`
- Use `@modelcontextprotocol/sdk`'s `StdioClientTransport`

**SSE:**
- Connect to `url` with optional `headers`
- Use `@modelcontextprotocol/sdk`'s `SSEClientTransport`
- Handle reconnection on disconnect

### Connection Lifecycle

```
loadConfig() → for each server:
  createTransport(config) → client.connect() → fetchTools() → register
```

On error: mark server as failed, emit event, allow manual reconnect.

---

## 3. Tool Integration

### Dynamic Tool Registration

When MCP servers connect, their tools are registered into the session's `ToolRegistry` with naming convention `mcp__<serverName>__<toolName>`.

Each MCP tool becomes a `ToolHandler`:
- `definition`: name, description, inputSchema from MCP server
- `execute()`: calls `mcpManager.callTool(server, tool, args)`, returns content as string

### Built-in MCP Tools

Two new built-in tools (always available when MCP is configured):

1. **`list_mcp_resources`** — Lists available resources from all connected servers
2. **`read_mcp_resource`** — Reads a specific resource by server name + URI

---

## 4. Session Integration

### Session Changes

- `Session` constructor accepts optional `McpManager`
- On session activation, MCP tools are registered alongside built-in tools
- System prompt includes MCP server names and their tool counts
- Tool execution routes `mcp__*` tools through McpManager

### Electron Integration

- `SessionManager` creates and owns the `McpManager` instance
- On app start: load MCP config, connect all servers
- IPC channels for UI:
  - `mcp:list-servers` — returns server states
  - `mcp:reconnect` — reconnect a specific server
  - `mcp:toggle` — enable/disable a server
  - `mcp:save-config` — save server configuration

---

## 5. UI: MCP Settings Panel

### Location

New tab/section in the settings panel (alongside model groups).

### Features

- List all configured MCP servers with status indicator (green/red/gray)
- Add new server (form: name, transport type, command/url, args, env, headers)
- Edit existing server
- Delete server
- Reconnect button per server
- Enable/disable toggle per server
- Show server's available tools list (expandable)

### Design

Follows existing Tactical Telemetry CRT brutalist style:
- Monospace, uppercase labels
- ASCII-style borders
- Status indicators as colored dots or text badges

---

## 6. Error Handling

- Connection timeout: 30s default, mark as failed
- Subprocess crash (stdio): mark as failed, log stderr
- Network error (SSE): mark as failed, allow reconnect
- Tool call error: return error content to model (isError: true)
- Config parse error: skip invalid entries, log warning

---

## 7. File Structure

```
packages/core/src/mcp/
  types.ts          — McpServerConfig, McpServerState, McpConnectionStatus
  config.ts         — loadMcpConfig(), saveMcpConfig(), mergeConfigs()
  manager.ts        — McpManager class (lifecycle, tool/resource access)
  mcp-tool-handler.ts — ToolHandler wrapper for MCP tools

packages/core/src/tools/
  list-mcp-resources.ts  — Built-in tool: list resources
  read-mcp-resource.ts   — Built-in tool: read resource

packages/electron/src/
  mcp-ipc.ts        — IPC handlers for MCP management

packages/ui/src/components/
  McpSettings.tsx    — MCP server management UI
```
