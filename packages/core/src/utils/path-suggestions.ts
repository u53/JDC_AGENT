import { readdirSync, existsSync } from 'node:fs'
import path from 'node:path'

/**
 * When a file is not found, look for files with the same base name but
 * different extension in the same directory. Helps the model self-correct
 * when it guesses the wrong extension (e.g., .ts vs .tsx, .js vs .mjs).
 */
export function findSimilarFile(filePath: string): string | undefined {
  try {
    const dir = path.dirname(filePath)
    const baseName = path.basename(filePath, path.extname(filePath))
    const entries = readdirSync(dir, { withFileTypes: true })

    const similar = entries.find(
      entry =>
        entry.isFile() &&
        path.basename(entry.name, path.extname(entry.name)) === baseName &&
        path.join(dir, entry.name) !== filePath
    )

    return similar ? path.join(dir, similar.name) : undefined
  } catch {
    return undefined
  }
}

/**
 * Detects the "dropped repo folder" pattern where the model constructs an
 * absolute path missing the repo directory component.
 *
 * Example:
 *   cwd = /Users/user/src/myRepo
 *   requestedPath = /Users/user/src/somefile.ts  (doesn't exist)
 *   returns        /Users/user/src/myRepo/somefile.ts  (if it exists)
 */
export function suggestPathUnderCwd(requestedPath: string, cwd: string): string | undefined {
  const cwdParent = path.dirname(cwd)
  const cwdParentPrefix = cwdParent === path.sep ? path.sep : cwdParent + path.sep

  // Only check if the requested path is under cwd's parent but not under cwd itself
  if (
    !requestedPath.startsWith(cwdParentPrefix) ||
    requestedPath.startsWith(cwd + path.sep) ||
    requestedPath === cwd
  ) {
    return undefined
  }

  // Try appending the relative part under cwd
  const relativePart = requestedPath.slice(cwdParent.length)
  const candidatePath = path.join(cwd, relativePart)

  if (existsSync(candidatePath)) {
    return candidatePath
  }

  // Also try just the basename under cwd
  const baseName = path.basename(requestedPath)
  const simpleCandidate = path.join(cwd, baseName)
  if (simpleCandidate !== candidatePath && existsSync(simpleCandidate)) {
    return simpleCandidate
  }

  return undefined
}

/**
 * Build a helpful error message when a file is not found.
 * Includes CWD note and suggestions for similar files.
 */
export function buildFileNotFoundError(filePath: string, cwd: string): string {
  const parts: string[] = [`Error: file not found: ${filePath}`]

  // Suggest similar file (different extension)
  const similar = findSimilarFile(filePath)
  if (similar) {
    parts.push(`Did you mean: ${similar}`)
  }

  // Suggest path under CWD
  const cwdSuggestion = suggestPathUnderCwd(filePath, cwd)
  if (cwdSuggestion) {
    parts.push(`Did you mean: ${cwdSuggestion}`)
  }

  parts.push(`Note: your current working directory is ${cwd}`)

  return parts.join('\n')
}
