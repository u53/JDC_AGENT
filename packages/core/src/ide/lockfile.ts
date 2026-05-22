import { readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join, posix, win32 } from 'node:path'
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
  } catch (e: any) {
    return e?.code === 'EPERM'
  }
}

export function matchesWorkspace(
  lockfile: IdeLockfile,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return lockfile.workspaceFolders.some(folder => isSubpath(folder, cwd, platform))
}

function isSubpath(parent: string, child: string, platform: NodeJS.Platform): boolean {
  const isWin = platform === 'win32'
  const p = isWin ? win32 : posix
  const norm = (raw: string): string => {
    let s = raw
    if (isWin) s = s.replace(/\//g, '\\')
    s = p.resolve(s)
    if (isWin) s = s.toLowerCase()
    return s
  }
  const a = norm(parent)
  const b = norm(child)
  if (a === b) return true
  const rel = p.relative(a, b)
  return rel.length > 0 && !rel.startsWith('..' + p.sep) && rel !== '..' && !p.isAbsolute(rel)
}

export function removeStaleLockfile(filePath: string): void {
  try { unlinkSync(filePath) } catch {}
}
