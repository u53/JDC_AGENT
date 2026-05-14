import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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
    const filePathInput = input.file_path as string | undefined
    const contentInput = input.content as string | undefined
    if (!filePathInput || contentInput === undefined) {
      return { content: 'Error: file_path and content are required', isError: true }
    }

    const filePath = path.isAbsolute(filePathInput)
      ? filePathInput
      : path.resolve(context.cwd, filePathInput)

    try {
      let contentBefore: string | null = null
      if (context.fileTracker && existsSync(filePath)) {
        contentBefore = await readFile(filePath, 'utf-8')
      }

      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, contentInput, 'utf-8')

      if (context.fileTracker && context.toolUseId) {
        await context.fileTracker.recordChange(filePath, contentBefore, contentInput, context.toolUseId, context.turnIndex || 0)
      }

      return { content: `Successfully wrote to ${filePath}` }
    } catch (err: any) {
      return { content: `Error writing file: ${err.message}`, isError: true }
    }
  },
}
