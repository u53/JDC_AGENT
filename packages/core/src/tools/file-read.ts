import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import { buildFileNotFoundError } from '../utils/path-suggestions.js'

export const fileReadTool: ToolHandler = {
  definition: {
    name: 'Read',
    description: `Read a file from the filesystem. Results are returned with line numbers (1-based).

Usage notes:
- By default reads up to 2000 lines. Use offset and limit for large files.
- Re-reading returns the current file content so later edits can rely on visible context.
- After a successful edit or write, the mutation is recorded as fresh state; re-read only when you need visible context.
- When you already know which part of the file you need, only read that part — important for larger files.
- This tool can read text files of any type. For binary files, it returns an error.
- When you need to understand code before modifying it, always read the relevant file first.`,
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
    const filePathInput = input.file_path as string | undefined
    if (!filePathInput) {
      return { content: 'Error: file_path is required', isError: true }
    }

    const filePath = path.isAbsolute(filePathInput)
      ? filePathInput
      : path.resolve(context.cwd, filePathInput)

    const offset = (input.offset as number) || 0
    const limit = (input.limit as number) || 2000

    try {
      const content = await readFile(filePath, 'utf-8')
      const lines = content.split('\n')
      const effectiveLimit = limit === Infinity ? lines.length : limit
      const slice = lines.slice(offset, offset + effectiveLimit)
      const endLine = Math.min(offset + effectiveLimit, lines.length)
      const returnedContent = slice.join('\n')
      const numbered = slice.map((line, i) => `${offset + i + 1}\t${line}`).join('\n')

      const continuation = endLine < lines.length
        ? `\n[Showing lines ${offset + 1}-${endLine} of ${lines.length}. Use offset=${endLine} to continue.]`
        : ''
      return {
        content: numbered + continuation,
        metadata: {
          fileRead: {
            filePath,
            offset,
            limit,
            totalLines: lines.length,
            content: returnedContent,
          },
        },
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { content: buildFileNotFoundError(filePath, context.cwd), isError: true }
      }
      return { content: `Error reading file: ${err.message}`, isError: true }
    }
  },
}
