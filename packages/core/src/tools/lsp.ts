import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import { lspManager } from '../lsp/lsp-manager.js'
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

type Operation = 'goToDefinition' | 'findReferences' | 'hover' | 'documentSymbol' | 'workspaceSymbol'

const OPERATION_METHODS: Record<Operation, string> = {
  goToDefinition: 'textDocument/definition',
  findReferences: 'textDocument/references',
  hover: 'textDocument/hover',
  documentSymbol: 'textDocument/documentSymbol',
  workspaceSymbol: 'workspace/symbol',
}

export const lspTool: ToolHandler = {
  definition: {
    name: 'lsp',
    description: `Interact with Language Server Protocol servers for code intelligence.

Supported operations:
- goToDefinition: Find where a symbol is defined
- findReferences: Find all references to a symbol
- hover: Get type info and documentation for a symbol
- documentSymbol: Get all symbols (functions, classes, variables) in a file
- workspaceSymbol: Search for symbols across the entire workspace

Use this for precise code navigation instead of grep when you need type-aware results. Requires line and character position (1-based).`,
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['goToDefinition', 'findReferences', 'hover', 'documentSymbol', 'workspaceSymbol'],
          description: 'The LSP operation to perform',
        },
        filePath: { type: 'string', description: 'Absolute path to the file' },
        line: { type: 'number', description: 'Line number (1-based)' },
        character: { type: 'number', description: 'Character offset (1-based)' },
        query: { type: 'string', description: 'Search query (for workspaceSymbol)' },
      },
      required: ['operation', 'filePath'],
    },
  },

  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const operation = input.operation as Operation | undefined
    const filePath = input.filePath as string | undefined
    if (!operation || !filePath) {
      return { content: 'Error: operation and filePath are required', isError: true }
    }
    const line = (input.line as number) || 1
    const character = (input.character as number) || 1
    const query = (input.query as string) || ''

    try {
      const client = await lspManager.getClient(filePath, context.cwd)
      if (!client) {
        const ext = path.extname(filePath)
        return { content: `No language server available for '${ext}' files`, isError: true }
      }

      const method = OPERATION_METHODS[operation]
      let params: unknown

      if (operation === 'workspaceSymbol') {
        params = { query }
      } else if (operation === 'documentSymbol') {
        params = {
          textDocument: { uri: pathToFileUri(filePath) },
        }
      } else {
        // Convert 1-based to 0-based for LSP protocol
        params = {
          textDocument: { uri: pathToFileUri(filePath) },
          position: { line: line - 1, character: character - 1 },
          context: operation === 'findReferences' ? { includeDeclaration: true } : undefined,
        }
      }

      const result = await client.request(method, params)
      return { content: JSON.stringify(result, null, 2) || 'No results', isError: false }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { content: `LSP error: ${message}`, isError: true }
    }
  },
}
