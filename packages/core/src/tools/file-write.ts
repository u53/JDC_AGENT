import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export const fileWriteTool: ToolHandler = {
  definition: {
    name: 'file_write',
    description: 'Write content to a file, creating it if it does not exist.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute or relative path' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['file_path', 'content'],
    },
  },
  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = path.isAbsolute(input.file_path as string)
      ? (input.file_path as string)
      : path.resolve(context.cwd, input.file_path as string)

    try {
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, input.content as string, 'utf-8')
      return { content: `Successfully wrote to ${filePath}` }
    } catch (err: any) {
      return { content: `Error writing file: ${err.message}`, isError: true }
    }
  },
}
