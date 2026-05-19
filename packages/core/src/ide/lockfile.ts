import { readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { IdeLockfile } from './types.js'

export interface ScannedLockfile {
  port: number
  path: string
  lockfile: IdeLockfile
}

export function scanLockfiles(dir: string): ScannedLockfile[] {
  let files: string[]
  try { files = readdirSync(dir) } catch { return [] }

  const results: ScannedLockfile[] = []
  for (const file of files) {
    if (!file.endsWith('.lock')) continue
    const port = parseInt(file.replace('.lock', ''), 10)
    if (isNaN(port)) continue

    const filePath = join(dir, file)
    try {
      const content = readFileSync(filePath, 'utf-8')
      const lockfile = JSON.parse(content) as IdeLockfile
      if (!lockfile.workspaceFolders || !lockfile.pid || !lockfile.authToken) continue
      results.push({ port, path: filePath, lockfile })
    } catch {
      continue
    }
  }
  return results
}

export function isLockfileValid(lockfile: IdeLockfile): boolean {
  try {
    process.kill(lockfile.pid, 0)
    return true
  } catch {
    return false
  }
}

export function matchesWorkspace(lockfile: IdeLockfile, cwd: string): boolean {
  const normalizedCwd = cwd.replace(/\/+$/, '')
  return lockfile.workspaceFolders.some(folder => {
    const normalizedFolder = folder.replace(/\/+$/, '')
    return normalizedCwd === normalizedFolder || normalizedCwd.startsWith(normalizedFolder + '/')
  })
}

export function removeStaleLockfile(filePath: string): void {
  try { unlinkSync(filePath) } catch {}
}
