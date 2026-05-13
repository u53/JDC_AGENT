import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export const lsTool: ToolHandler = {
  definition: {
    name: 'ls',
    description: 'List directory contents with file types and sizes.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path. Defaults to cwd.' },
      },
      required: [],
    },
  },
  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const dirPath = input.path ? path.resolve(context.cwd, input.path as string) : context.cwd
    try {
      const entries = await readdir(dirPath, { withFileTypes: true })
      const lines: string[] = []
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.') && entry.name !== '.jdcagnet') continue
        if (entry.isDirectory()) {
          lines.push(`${entry.name}/`)
        } else {
          const s = await stat(path.join(dirPath, entry.name)).catch(() => null)
          const size = s ? formatSize(s.size) : ''
          lines.push(`${entry.name}  ${size}`)
        }
      }
      return { content: lines.join('\n') || '(empty directory)' }
    } catch (err: any) {
      return { content: `Error: ${err.message}`, isError: true }
    }
  },
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`
}
