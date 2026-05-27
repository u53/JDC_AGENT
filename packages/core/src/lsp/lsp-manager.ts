import { LspClient } from './lsp-client.js'
import path from 'node:path'

/**
 * Convert a file path to a proper file:// URI.
 * On Windows: C:\Users\foo → file:///C:/Users/foo
 * On Unix: /home/foo → file:///home/foo
 */
function pathToFileUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  if (/^[A-Za-z]:/.test(normalized)) {
    return `file:///${normalized}`
  }
  return `file://${normalized}`
}

interface ServerConfig {
  command: string
  args: string[]
}

const EXTENSION_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'typescript',
  '.jsx': 'typescript',
  '.py': 'python',
  '.rs': 'rust',
}

const SERVER_CONFIGS: Record<string, ServerConfig> = {
  typescript: { command: 'typescript-language-server', args: ['--stdio'] },
  python: { command: 'pylsp', args: [] },
  rust: { command: 'rust-analyzer', args: [] },
}

export class LspManager {
  private clients = new Map<string, LspClient>()
  private initializing = new Map<string, Promise<LspClient>>()

  async getClient(filePath: string, cwd: string): Promise<LspClient | null> {
    const ext = path.extname(filePath)
    const language = EXTENSION_MAP[ext]
    if (!language) return null

    const config = SERVER_CONFIGS[language]
    if (!config) return null

    if (this.clients.has(language)) {
      return this.clients.get(language)!
    }

    if (this.initializing.has(language)) {
      return this.initializing.get(language)!
    }

    const initPromise = this.startClient(language, config, cwd)
    this.initializing.set(language, initPromise)

    try {
      const client = await initPromise
      this.clients.set(language, client)
      return client
    } finally {
      this.initializing.delete(language)
    }
  }

  private async startClient(language: string, config: ServerConfig, cwd: string): Promise<LspClient> {
    const client = new LspClient()
    await client.start(config.command, config.args, cwd)

    // Initialize the LSP server
    const rootUri = pathToFileUri(cwd)
    await client.request('initialize', {
      processId: process.pid,
      capabilities: {},
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: path.basename(cwd) }],
    })

    client.notify('initialized', {})
    return client
  }

  async shutdown(): Promise<void> {
    for (const [, client] of this.clients) {
      try {
        await client.request('shutdown', null)
        client.notify('exit', null)
      } catch {
        // best effort
      }
      client.stop()
    }
    this.clients.clear()
  }
}

export const lspManager = new LspManager()
