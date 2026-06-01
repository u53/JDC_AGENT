// Full project scan: enumerate source files the engine can index.

import fg from 'fast-glob'
import picomatch from 'picomatch'
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { supportedExtensions, languageForPath } from '../parser/languages.js'

const IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.next/**',
  '**/coverage/**',
  '**/vendor/**',
  '**/*.min.js',
]

export interface ScannedFile {
  /** Absolute path. */
  absPath: string
  /** Project-relative POSIX path. */
  relPath: string
  languageId: string
}

/** Read .gitignore at the project root into fast-glob ignore patterns. */
function gitignorePatterns(cwd: string): string[] {
  const file = path.join(cwd, '.gitignore')
  if (!existsSync(file)) return []
  const out: string[] = []
  try {
    for (const raw of readFileSync(file, 'utf-8').split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#') || line.startsWith('!')) continue
      const clean = line.replace(/^\/+/, '').replace(/\/+$/, '')
      if (!clean) continue
      out.push(`**/${clean}/**`)
      out.push(`**/${clean}`)
    }
  } catch {
    /* ignore unreadable .gitignore */
  }
  return out
}

/** The full ignore pattern set (built-in dirs + project .gitignore). */
export function ignorePatternsFor(cwd: string): string[] {
  return [...IGNORE, ...gitignorePatterns(cwd)]
}

/**
 * Build a predicate that returns true when a project-relative POSIX path should
 * be ignored. Shared by the full scan and the live watcher so both honor the
 * same rules — including .gitignore'd generated paths (docs/, *.gen.ts, etc.).
 */
export function createIgnoreMatcher(cwd: string): (relPosixPath: string) => boolean {
  const patterns = ignorePatternsFor(cwd)
  const isMatch = picomatch(patterns, { dot: true })
  return (relPosixPath: string) => isMatch(relPosixPath)
}

/** Enumerate indexable files under cwd. Honors common ignore dirs + .gitignore. */
export async function scanProject(cwd: string, maxFiles = 20000): Promise<ScannedFile[]> {
  const exts = supportedExtensions().map((e) => e.slice(1))
  const pattern = `**/*.{${exts.join(',')}}`
  const entries = await fg(pattern, {
    cwd,
    ignore: ignorePatternsFor(cwd),
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
    suppressErrors: true,
  })

  const out: ScannedFile[] = []
  for (const rel of entries) {
    if (out.length >= maxFiles) break
    const languageId = languageForPath(rel)
    if (!languageId) continue
    out.push({
      absPath: path.join(cwd, rel),
      relPath: toPosix(rel),
      languageId,
    })
  }
  return out
}

export async function readFileSafe(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, 'utf-8')
  } catch {
    return null
  }
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}
