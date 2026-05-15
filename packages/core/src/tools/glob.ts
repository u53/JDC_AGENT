import fg from 'fast-glob'
import path from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

const MAX_RESULTS = 100

export const globTool: ToolHandler = {
  definition: {
    name: 'glob',
    description: `Find files matching a glob pattern. Returns up to 100 file paths.

Usage notes:
- Use this instead of bash find for locating files by name or extension.
- Common patterns: "**/*.ts" (all TypeScript), "src/**/*.{js,jsx}" (JS in src), "**/test*" (test files).
- Automatically ignores node_modules and .git directories.
- If you get too many results, narrow the pattern or specify a subdirectory in the path parameter.`,
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.ts", "src/**/*.{js,jsx}")' },
        path: { type: 'string', description: 'Directory to search in. Defaults to cwd.' },
      },
      required: ['pattern'],
    },
  },
  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const pattern = input.pattern as string | undefined
    if (!pattern) {
      return { content: 'Error: pattern is required', isError: true }
    }
    const searchPath = input.path ? path.resolve(context.cwd, input.path as string) : context.cwd

    try {
      const files = await fg(pattern, {
        cwd: searchPath,
        onlyFiles: true,
        ignore: ['**/node_modules/**', '**/.git/**'],
        absolute: false,
      })

      const truncated = files.length > MAX_RESULTS
      const results = files.slice(0, MAX_RESULTS)

      if (results.length === 0) return { content: 'No files found matching pattern.' }

      let output = results.join('\n')
      if (truncated) output += `\n\n(truncated: showing ${MAX_RESULTS} of ${files.length} results)`
      return { content: output }
    } catch (err: any) {
      return { content: `Error: ${err.message}`, isError: true }
    }
  },
}
