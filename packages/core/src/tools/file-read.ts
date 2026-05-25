import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import { buildFileNotFoundError } from '../utils/path-suggestions.js'

export const FILE_UNCHANGED_MESSAGE = 'File unchanged since last read. The content from the earlier file_read result in this conversation is still current — refer to that instead of re-reading.'

export const fileReadTool: ToolHandler = {
  definition: {
    name: 'file_read',
    description: `Read a file from the filesystem. Results are returned with line numbers (1-based).

Usage notes:
- By default reads up to 2000 lines. Use offset and limit for large files.
- Do NOT re-read a file you just edited — the edit was successful if no error was returned.
- If you re-read an unchanged file, you'll get a stub message pointing you to the earlier result.
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

    // Dedup: if we've already read this exact range and the file hasn't changed, return stub
    if (context.fileReadState?.canDedup(filePath, offset, limit)) {
      return { content: FILE_UNCHANGED_MESSAGE }
    }

    try {
      const content = await readFile(filePath, 'utf-8')
      const lines = content.split('\n')
      const effectiveLimit = limit === Infinity ? lines.length : limit
      const slice = lines.slice(offset, offset + effectiveLimit)
      const numbered = slice.map((line, i) => `${offset + i + 1}\t${line}`).join('\n')

      // Record this read for future dedup checks
      context.fileReadState?.recordRead(filePath, offset, limit)

      return { content: numbered }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { content: buildFileNotFoundError(filePath, context.cwd), isError: true }
      }
      return { content: `Error reading file: ${err.message}`, isError: true }
    }
  },
}
