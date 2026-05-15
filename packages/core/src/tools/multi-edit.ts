import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

interface EditOp {
  old_string: string
  new_string: string
}

export const multiEditTool: ToolHandler = {
  definition: {
    name: 'multi_edit',
    description: `Apply multiple string replacements to a single file atomically. All edits succeed or none are applied.

Use this instead of multiple file_edit calls when:
- You need to make several related changes to the same file
- Later edits depend on earlier ones (edits are applied in order)
- You want atomic behavior (all-or-nothing)

Each edit's old_string must be unique in the file at the point it's applied.`,
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file' },
        edits: {
          type: 'array',
          description: 'Array of {old_string, new_string} replacements applied in order',
          items: {
            type: 'object',
            properties: {
              old_string: { type: 'string' },
              new_string: { type: 'string' },
            },
            required: ['old_string', 'new_string'],
          },
        },
      },
      required: ['file_path', 'edits'],
    },
  },
  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePathInput = input.file_path as string
    const edits = input.edits as EditOp[]
    if (!filePathInput || !edits || !Array.isArray(edits)) {
      return { content: 'Error: file_path and edits array are required', isError: true }
    }

    const filePath = path.isAbsolute(filePathInput) ? filePathInput : path.resolve(context.cwd, filePathInput)

    let content: string
    try {
      content = await readFile(filePath, 'utf-8')
    } catch (err: any) {
      return { content: `Error reading file: ${err.message}`, isError: true }
    }

    const original = content
    for (let i = 0; i < edits.length; i++) {
      const { old_string, new_string } = edits[i]
      if (!content.includes(old_string)) {
        return { content: `Error: edit ${i + 1} old_string not found in file (after applying previous edits)`, isError: true }
      }
      const occurrences = content.split(old_string).length - 1
      if (occurrences > 1) {
        return { content: `Error: edit ${i + 1} old_string appears ${occurrences} times, must be unique`, isError: true }
      }
      content = content.replace(old_string, new_string)
    }

    await writeFile(filePath, content, 'utf-8')
    if (context.fileTracker && context.toolUseId) {
      await context.fileTracker.recordChange(filePath, original, content, context.toolUseId, context.turnIndex || 0)
    }
    return { content: `Successfully applied ${edits.length} edits to ${filePath}` }
  },
}
