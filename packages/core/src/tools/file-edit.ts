import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import { buildFileNotFoundError } from '../utils/path-suggestions.js'

export const fileEditTool: ToolHandler = {
  definition: {
    name: 'file_edit',
    description: `Performs exact string replacement in a file.

Usage notes:
- You MUST read the file with file_read before editing. Never edit a file you haven't read in this conversation.
- ALWAYS prefer editing existing files over creating new ones. NEVER write new files unless explicitly required.
- The old_string must be UNIQUE in the file. If it appears multiple times, the edit will fail — provide more surrounding context to make it unique, or use replace_all: true.
- Preserve exact indentation (tabs/spaces) from the file. Match what you saw in file_read output (after the line number prefix).
- If your replacement exceeds 50 lines, split into multiple file_edit calls.
- Use replace_all: true when renaming a variable or string across the entire file.
- old_string and new_string must be different.
- Only use emojis in content if the user explicitly requests it.`,
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
        context.fileReadState?.invalidate(filePath)
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
      context.fileReadState?.invalidate(filePath)

      if (context.fileTracker && context.toolUseId) {
        await context.fileTracker.recordChange(filePath, content, updated, context.toolUseId, context.turnIndex || 0)
      }

      return { content: `Successfully edited ${filePath}` }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { content: buildFileNotFoundError(filePath, context.cwd), isError: true }
      }
      return { content: `Error editing file: ${err.message}`, isError: true }
    }
  },
}
