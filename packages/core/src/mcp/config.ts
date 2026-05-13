import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { McpServerConfig, McpConfigFile } from './types.js'

const CONFIG_DIR = path.join(os.homedir(), '.jdcagnet')
const GLOBAL_CONFIG_PATH = path.join(CONFIG_DIR, 'mcp-servers.json')

export function loadMcpConfig(cwd: string, globalPath: string = GLOBAL_CONFIG_PATH): Record<string, McpServerConfig> {
  const globalServers = loadConfigFile(globalPath)
  const projectPath = path.join(cwd, '.jdcagnet', 'mcp-servers.json')
  const projectServers = loadConfigFile(projectPath)
  return mergeConfigs(globalServers, projectServers)
}

export function saveMcpConfig(servers: Record<string, McpServerConfig>, scope: 'global' | 'project', cwd?: string): void {
  const configFile: McpConfigFile = { mcpServers: servers }
  let filePath: string
  if (scope === 'global') {
    mkdirSync(CONFIG_DIR, { recursive: true })
    filePath = GLOBAL_CONFIG_PATH
  } else {
    if (!cwd) throw new Error('cwd required for project scope')
    const dir = path.join(cwd, '.jdcagnet')
    mkdirSync(dir, { recursive: true })
    filePath = path.join(dir, 'mcp-servers.json')
  }
  writeFileSync(filePath, JSON.stringify(configFile, null, 2), 'utf-8')
}

export function mergeConfigs(
  global: Record<string, McpServerConfig>,
  project: Record<string, McpServerConfig>
): Record<string, McpServerConfig> {
  return { ...global, ...project }
}

function loadConfigFile(filePath: string): Record<string, McpServerConfig> {
  if (!existsSync(filePath)) return {}
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as McpConfigFile
    return raw.mcpServers || {}
  } catch {
    return {}
  }
}
