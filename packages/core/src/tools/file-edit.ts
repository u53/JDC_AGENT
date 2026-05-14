import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export const fileEditTool: ToolHandler = {
  definition: {
    name: 'file_edit',
    description: 'Replace a specific string in a file with new content.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file' },
        old_string: { type: 'string', description: 'The exact string to replace' },
        new_string: { type: 'string', description: 'The replacement string' },
        replace_all: { type: 'boolean', description: 'Replace all occurrences of old_string (default: false)' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePathInput = input.file_path as string | undefined
    const oldStr = input.old_string as string | undefined
    const newStr = input.new_string as string | undefined
    const replaceAll = input.replace_all as boolean || false
    if (!filePathInput || oldStr === undefined || newStr === undefined) {
      return { content: 'Error: file_path, old_string, and new_string are required', isError: true }
    }

    const filePath = path.isAbsolute(filePathInput)
      ? filePathInput
      : path.resolve(context.cwd, filePathInput)

    try {
      const content = await readFile(filePath, 'utf-8')

      if (!content.includes(oldStr)) {
        return { content: `Error: old_string not found in file`, isError: true }
      }

      if (replaceAll) {
        const occurrences = content.split(oldStr).length - 1
        const updated = content.replaceAll(oldStr, newStr)
        await writeFile(filePath, updated, 'utf-8')
        if (context.fileTracker && context.toolUseId) {
          await context.fileTracker.recordChange(filePath, content, updated, context.toolUseId, context.turnIndex || 0)
        }
        return { content: `Successfully replaced ${occurrences} occurrences in ${filePath}` }
      }

      const occurrences = content.split(oldStr).length - 1
      if (occurrences > 1) {
        return { content: `Error: old_string appears ${occurrences} times, must be unique`, isError: true }
      }

      const updated = content.replace(oldStr, newStr)
      await writeFile(filePath, updated, 'utf-8')

      if (context.fileTracker && context.toolUseId) {
        await context.fileTracker.recordChange(filePath, content, updated, context.toolUseId, context.turnIndex || 0)
      }

      return { content: `Successfully edited ${filePath}` }
    } catch (err: any) {
      return { content: `Error editing file: ${err.message}`, isError: true }
    }
  },
}
