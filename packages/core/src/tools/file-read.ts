import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export const fileReadTool: ToolHandler = {
  definition: {
    name: 'file_read',
    description: 'Read a file from the filesystem.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute or relative path to the file' },
        offset: { type: 'number', description: 'Line number to start reading from (0-based)' },
        limit: { type: 'number', description: 'Number of lines to read' },
      },
      required: ['file_path'],
    },
  },
  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = path.isAbsolute(input.file_path as string)
      ? (input.file_path as string)
      : path.resolve(context.cwd, input.file_path as string)

    try {
      const content = await readFile(filePath, 'utf-8')
      const lines = content.split('\n')
      const offset = (input.offset as number) || 0
      const limit = (input.limit as number) || lines.length
      const slice = lines.slice(offset, offset + limit)
      const numbered = slice.map((line, i) => `${offset + i + 1}\t${line}`).join('\n')
      return { content: numbered }
    } catch (err: any) {
      return { content: `Error reading file: ${err.message}`, isError: true }
    }
  },
}
