/**
 * Convert a Windows native path to a POSIX path for use inside Git Bash.
 * e.g. "C:\\Users\\foo\\bar" → "/c/Users/foo/bar"
 */
export function windowsPathToPosix(winPath: string): string {
  // Handle UNC paths: \\server\share → //server/share
  if (winPath.startsWith('\\\\')) {
    return winPath.replace(/\\/g, '/')
  }
  // Handle drive letter: C:\foo → /c/foo
  const match = winPath.match(/^([A-Za-z]):\\(.*)$/)
  if (match) {
    const drive = match[1]!.toLowerCase()
    const rest = match[2]!.replace(/\\/g, '/')
    return `/${drive}/${rest}`
  }
  // Relative path or already POSIX-like
  return winPath.replace(/\\/g, '/')
}

/**
 * Convert a POSIX path (from Git Bash) back to a Windows native path.
 * e.g. "/c/Users/foo/bar" → "C:\\Users\\foo\\bar"
 */
export function posixPathToWindows(posixPath: string): string {
  // Handle /c/... → C:\...
  const match = posixPath.match(/^\/([a-zA-Z])\/(.*)$/)
  if (match) {
    const drive = match[1]!.toUpperCase()
    const rest = match[2]!.replace(/\//g, '\\')
    return `${drive}:\\${rest}`
  }
  return posixPath.replace(/\//g, '\\')
}

/**
 * Rewrite Windows CMD-style null redirects to POSIX style.
 * The model sometimes emits "2>nul" which creates a literal file named "nul" in Git Bash.
 */
export function rewriteWindowsNullRedirect(command: string): string {
  return command.replace(/(\d?)>nul\b/gi, '$1>/dev/null')
}
