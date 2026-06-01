// Git-derived context: recently changed files (hot zones), the current
// uncommitted diff summary, and per-line blame. All best-effort — a non-git
// directory simply yields empty results.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await exec('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 })
    return stdout
  } catch {
    return null
  }
}

export interface GitHotFile {
  /** Project-relative path. */
  path: string
  /** Number of recent commits touching this file. */
  commits: number
}

/** Files most frequently changed in the last `maxCommits` commits. */
export async function hotFiles(cwd: string, maxCommits = 100, limit = 20): Promise<GitHotFile[]> {
  const out = await git(cwd, [
    'log',
    `-n${maxCommits}`,
    '--name-only',
    '--pretty=format:',
  ])
  if (!out) return []
  const counts = new Map<string, number>()
  for (const line of out.split('\n')) {
    const p = line.trim()
    if (!p) continue
    counts.set(p, (counts.get(p) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([path, commits]) => ({ path, commits }))
    .sort((a, b) => b.commits - a.commits)
    .slice(0, limit)
}

export interface GitChange {
  path: string
  status: string
}

/** Currently modified/added/deleted files (staged + unstaged). */
export async function workingChanges(cwd: string): Promise<GitChange[]> {
  const out = await git(cwd, ['status', '--porcelain'])
  if (!out) return []
  const changes: GitChange[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const status = line.slice(0, 2).trim()
    const path = line.slice(3).trim()
    if (path) changes.push({ path, status })
  }
  return changes
}

/** Unified diff of uncommitted changes (optionally for one file). */
export async function uncommittedDiff(cwd: string, filePath?: string): Promise<string | null> {
  const args = ['diff', '--no-color']
  if (filePath) args.push('--', filePath)
  return git(cwd, args)
}

export interface BlameLine {
  line: number
  author: string
  commit: string
}

/** Blame a line range of a file. Returns per-line author/commit. */
export async function blameRange(
  cwd: string,
  filePath: string,
  startLine: number,
  endLine: number,
): Promise<BlameLine[]> {
  const out = await git(cwd, [
    'blame',
    '--line-porcelain',
    `-L${startLine},${endLine}`,
    '--',
    filePath,
  ])
  if (!out) return []
  const result: BlameLine[] = []
  let curCommit = ''
  let curAuthor = ''
  let curLine = startLine
  for (const line of out.split('\n')) {
    if (/^[0-9a-f]{40}\b/.test(line)) {
      const parts = line.split(' ')
      curCommit = parts[0].slice(0, 8)
      curLine = parseInt(parts[2], 10) || curLine
    } else if (line.startsWith('author ')) {
      curAuthor = line.slice('author '.length)
    } else if (line.startsWith('\t')) {
      result.push({ line: curLine, author: curAuthor, commit: curCommit })
    }
  }
  return result
}
