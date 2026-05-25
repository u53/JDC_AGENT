import { readdir } from 'node:fs/promises'
import path from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

const MAX_ENTRIES = 200
const DEFAULT_DEPTH = 4
const IGNORE = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__'])

export const treeTool: ToolHandler = {
  definition: {
    name: 'tree',
    description: 'Show recursive directory structure to understand project layout. Auto-ignores node_modules/.git/dist. Limited to 4 levels deep and 200 entries. For single-directory listing, use ls; for finding specific files by pattern, use glob.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Root directory. Defaults to cwd.' },
        depth: { type: 'number', description: 'Max depth (default 4)' },
      },
      required: [],
    },
  },
  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const rootPath = input.path ? path.resolve(context.cwd, input.path as string) : context.cwd
    const maxDepth = Math.min((input.depth as number) || DEFAULT_DEPTH, 6)
    const lines: string[] = []
    let count = 0

    async function walk(dir: string, prefix: string, depth: number) {
      if (depth > maxDepth || count >= MAX_ENTRIES) return
      let entries
      try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
      entries = entries.filter(e => !IGNORE.has(e.name) && !e.name.startsWith('.'))
      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1
        if (!a.isDirectory() && b.isDirectory()) return 1
        return a.name.localeCompare(b.name)
      })
      for (let i = 0; i < entries.length && count < MAX_ENTRIES; i++) {
        const entry = entries[i]
        const isLast = i === entries.length - 1
        const connector = isLast ? '└── ' : '├── '
        const name = entry.isDirectory() ? `${entry.name}/` : entry.name
        lines.push(`${prefix}${connector}${name}`)
        count++
        if (entry.isDirectory()) {
          await walk(
            path.join(dir, entry.name),
            prefix + (isLast ? '    ' : '│   '),
            depth + 1,
          )
        }
      }
    }

    lines.push(path.basename(rootPath) + '/')
    count++
    await walk(rootPath, '', 1)

    if (count >= MAX_ENTRIES) lines.push(`\n(truncated at ${MAX_ENTRIES} entries)`)
    return { content: lines.join('\n') }
  },
}
