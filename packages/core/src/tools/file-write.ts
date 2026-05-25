import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export const fileWriteTool: ToolHandler = {
  definition: {
    name: 'file_write',
    description: `Write content to a file, creating it if it does not exist. Overwrites existing content.

Usage notes:
- If the file already exists, you MUST read it with file_read first to understand what you're replacing.
- Prefer file_edit for modifying existing files — it only sends the diff and is easier to review.
- Only use file_write for creating new files or complete rewrites.
- NEVER create documentation files (*.md) or README files unless the user explicitly requests it.
- If the content exceeds 150 lines, write the first 50 lines with this tool, then use file_edit to append the rest in chunks.
- Do NOT re-read a file after writing — the write was successful if no error was returned.
- Only use emojis in file content if the user explicitly requests it.`,
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
      context.fileReadState?.invalidate(filePath)

      if (context.fileTracker && context.toolUseId) {
        await context.fileTracker.recordChange(filePath, contentBefore, contentInput, context.toolUseId, context.turnIndex || 0)
      }

      return { content: `Successfully wrote to ${filePath}` }
    } catch (err: any) {
      return { content: `Error writing file: ${err.message}`, isError: true }
    }
  },
}
