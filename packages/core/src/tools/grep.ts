import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'
import fg from 'fast-glob'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export const grepTool: ToolHandler = {
  definition: {
    name: 'grep',
    description: `Search file contents using regex. Returns matching lines with file paths and line numbers.

Usage notes:
- Always prefer this tool over running bash grep/rg. It handles rg detection, result truncation, and abort signals automatically.
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

    // Try rg first, then grep, then fall back to pure JS
    const rgAvailable = await commandExists('rg')
    if (rgAvailable) {
      return runExternalGrep('rg', buildRgArgs(pattern, searchPath, glob, countOnly), context)
    }

    const grepAvailable = await commandExists('grep')
    if (grepAvailable) {
      return runExternalGrep('grep', buildGrepArgs(pattern, searchPath, glob, countOnly), context)
    }

    // Pure JS fallback (works on all platforms without external tools)
    return runJsGrep(pattern, searchPath, glob, countOnly)
  },
}

function runExternalGrep(cmd: string, args: string[], context: ToolContext): Promise<ToolResult> {
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
    proc.on('error', () => resolve({ content: `Error: ${cmd} not available`, isError: true }))
    context.signal?.addEventListener('abort', () => proc.kill())
  })
}

async function runJsGrep(pattern: string, searchPath: string, glob: string | undefined, countOnly: boolean | undefined): Promise<ToolResult> {
  let regex: RegExp
  try {
    regex = new RegExp(pattern)
  } catch (e: any) {
    return { content: `Error: invalid regex: ${e.message}`, isError: true }
  }

  const globPattern = glob || '**/*'
  const files = await fg(globPattern, {
    cwd: searchPath,
    onlyFiles: true,
    ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
    absolute: true,
  })

  const results: string[] = []
  const counts: Map<string, number> = new Map()
  const MAX_RESULTS = 200

  for (const file of files) {
    if (results.length >= MAX_RESULTS) break
    try {
      const rl = createInterface({ input: createReadStream(file, 'utf-8'), crlfDelay: Infinity })
      let lineNum = 0
      for await (const line of rl) {
        lineNum++
        if (regex.test(line)) {
          const relPath = path.relative(searchPath, file)
          if (countOnly) {
            counts.set(relPath, (counts.get(relPath) || 0) + 1)
          } else {
            results.push(`${relPath}:${lineNum}:${line}`)
            if (results.length >= MAX_RESULTS) break
          }
        }
      }
    } catch {
      // Skip binary/unreadable files
    }
  }

  if (countOnly) {
    if (counts.size === 0) return { content: 'No matches found.' }
    const output = [...counts.entries()].map(([f, c]) => `${f}:${c}`).join('\n')
    return { content: output }
  }

  if (results.length === 0) return { content: 'No matches found.' }
  const truncated = results.length >= MAX_RESULTS
  const output = results.join('\n') + (truncated ? `\n\n(truncated at ${MAX_RESULTS} matches)` : '')
  return { content: output }
}

function commandExists(cmd: string): Promise<boolean> {
  const checkCmd = process.platform === 'win32' ? 'where.exe' : 'which'
  return new Promise((resolve) => {
    const proc = spawn(checkCmd, [cmd], { stdio: 'ignore' })
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
