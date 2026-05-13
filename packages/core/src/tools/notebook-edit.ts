import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export const notebookEditTool: ToolHandler = {
  definition: {
    name: 'notebook_edit',
    description: 'Edit a Jupyter notebook cell. Supports replace, insert, and delete operations.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_path: { type: 'string', description: 'Path to the .ipynb file' },
        cell_number: { type: 'number', description: 'Cell index (0-based)' },
        new_source: { type: 'string', description: 'New source content for the cell' },
        edit_mode: {
          type: 'string',
          enum: ['replace', 'insert', 'delete'],
          description: 'Edit mode (default: replace)',
        },
        cell_type: {
          type: 'string',
          enum: ['code', 'markdown'],
          description: 'Cell type for insert mode',
        },
      },
      required: ['notebook_path', 'cell_number', 'new_source'],
    },
  },

  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const nbPath = path.resolve(context.cwd, input.notebook_path as string)
    const cellNum = input.cell_number as number
    const newSource = input.new_source as string
    const mode = (input.edit_mode as string) || 'replace'
    const cellType = (input.cell_type as string) || 'code'

    try {
      const raw = await readFile(nbPath, 'utf-8')
      const nb = JSON.parse(raw)

      if (!nb.cells || !Array.isArray(nb.cells)) {
        return { content: 'Error: invalid notebook format', isError: true }
      }

      const sourceLines = newSource
        .split('\n')
        .map((line, i, arr) => (i < arr.length - 1 ? line + '\n' : line))

      if (mode === 'replace') {
        if (cellNum < 0 || cellNum >= nb.cells.length) {
          return {
            content: `Error: cell ${cellNum} out of range (0-${nb.cells.length - 1})`,
            isError: true,
          }
        }
        nb.cells[cellNum].source = sourceLines
      } else if (mode === 'insert') {
        const newCell = {
          cell_type: cellType,
          source: sourceLines,
          metadata: {},
          ...(cellType === 'code' ? { outputs: [], execution_count: null } : {}),
        }
        nb.cells.splice(cellNum, 0, newCell)
      } else if (mode === 'delete') {
        if (cellNum < 0 || cellNum >= nb.cells.length) {
          return { content: `Error: cell ${cellNum} out of range`, isError: true }
        }
        nb.cells.splice(cellNum, 1)
      }

      await writeFile(nbPath, JSON.stringify(nb, null, 1), 'utf-8')
      return { content: `Notebook updated: ${mode} cell ${cellNum}` }
    } catch (err: any) {
      return { content: `Error: ${err.message}`, isError: true }
    }
  },
}
