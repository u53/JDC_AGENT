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
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = path.isAbsolute(input.file_path as string)
      ? (input.file_path as string)
      : path.resolve(context.cwd, input.file_path as string)

    try {
      const content = await readFile(filePath, 'utf-8')
      const oldStr = input.old_string as string
      const newStr = input.new_string as string

      if (!content.includes(oldStr)) {
        return { content: `Error: old_string not found in file`, isError: true }
      }

      const occurrences = content.split(oldStr).length - 1
      if (occurrences > 1) {
        return { content: `Error: old_string appears ${occurrences} times, must be unique`, isError: true }
      }

      const updated = content.replace(oldStr, newStr)
      await writeFile(filePath, updated, 'utf-8')
      return { content: `Successfully edited ${filePath}` }
    } catch (err: any) {
      return { content: `Error editing file: ${err.message}`, isError: true }
    }
  },
}
