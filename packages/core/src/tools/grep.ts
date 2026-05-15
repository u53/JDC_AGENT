import { spawn } from 'node:child_process'
import path from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export const grepTool: ToolHandler = {
  definition: {
    name: 'grep',
    description: `Search file contents using regex. Returns matching lines with file paths and line numbers.

Usage notes:
- Use this instead of bash grep/rg for code search.
- Use the glob parameter to filter by file type (e.g. "*.ts", "*.py").
- Results are truncated at 200 matches. Use a more specific pattern or path if you get too many results.
- Use include_count: true to get match counts per file (useful for understanding scope before diving in).`,
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'File or directory to search. Defaults to cwd.' },
        glob: { type: 'string', description: 'File glob filter (e.g. "*.ts")' },
        include_count: { type: 'boolean', description: 'Show match count per file instead of content' },
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
    const glob = input.glob as string | undefined
    const countOnly = input.include_count as boolean | undefined

    const useRg = await commandExists('rg')
    const args = useRg
      ? buildRgArgs(pattern, searchPath, glob, countOnly)
      : buildGrepArgs(pattern, searchPath, glob, countOnly)
    const cmd = useRg ? 'rg' : 'grep'

    return new Promise((resolve) => {
      const proc = spawn(cmd, args, { cwd: context.cwd, timeout: 30000 })
      let stdout = ''
      let stderr = ''
      proc.stdout.on('data', (d) => { stdout += d.toString() })
      proc.stderr.on('data', (d) => { stderr += d.toString() })
      proc.on('close', (code) => {
        if (code === 1 && !stdout) resolve({ content: 'No matches found.' })
        else if (code !== 0 && code !== 1) resolve({ content: `Error: ${stderr || 'search failed'}`, isError: true })
        else {
          const lines = stdout.split('\n').filter(Boolean)
          const truncated = lines.length > 200
          const output = lines.slice(0, 200).join('\n') + (truncated ? `\n\n(truncated: ${lines.length} total matches)` : '')
          resolve({ content: output || 'No matches found.' })
        }
      })
      proc.on('error', () => resolve({ content: 'Error: grep/rg not available', isError: true }))
      context.signal?.addEventListener('abort', () => proc.kill())
    })
  },
}

function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('which', [cmd])
    proc.on('close', (code) => resolve(code === 0))
    proc.on('error', () => resolve(false))
  })
}

function buildRgArgs(pattern: string, searchPath: string, glob?: string, count?: boolean): string[] {
  const args = ['--no-heading', '--line-number', '--color', 'never']
  if (count) args.push('--count')
  if (glob) args.push('--glob', glob)
  args.push('--', pattern, searchPath)
  return args
}

function buildGrepArgs(pattern: string, searchPath: string, glob?: string, count?: boolean): string[] {
  const args = ['-rn']
  if (count) args.push('-c')
  if (glob) args.push('--include', glob)
  args.push('--', pattern, searchPath)
  return args
}
