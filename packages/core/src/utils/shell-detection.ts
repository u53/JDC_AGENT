import { accessSync, constants } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { getPlatform } from './platform.js'

export type ShellType = 'bash' | 'powershell'
export type PowerShellEdition = 'core' | 'desktop'

export interface ShellInfo {
  type: ShellType
  path: string
  edition?: PowerShellEdition
}

const WINDOWS_GIT_BASH_PATHS = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  'C:\\msys64\\usr\\bin\\bash.exe',
  'C:\\cygwin64\\bin\\bash.exe',
  'C:\\cygwin\\bin\\bash.exe',
]

function fileExists(p: string): boolean {
  try {
    accessSync(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export function findGitBash(): string | null {
  if (getPlatform() !== 'windows') return null
  for (const p of WINDOWS_GIT_BASH_PATHS) {
    if (fileExists(p)) return p
  }
  return null
}

let cachedPsPath: string | null | undefined = undefined

export function findPowerShell(): string | null {
  if (cachedPsPath !== undefined) return cachedPsPath

  const checkCmd = process.platform === 'win32' ? 'where.exe' : 'which'

  // Try pwsh (PowerShell 7+) first
  try {
    const result = spawnSync(checkCmd, ['pwsh'], { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
    if (result.status === 0 && result.stdout?.trim()) {
      cachedPsPath = result.stdout.trim().split(/\r?\n/)[0]!
      return cachedPsPath
    }
  } catch {}

  // Fall back to powershell.exe (5.1)
  try {
    const result = spawnSync(checkCmd, ['powershell'], { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
    if (result.status === 0 && result.stdout?.trim()) {
      cachedPsPath = result.stdout.trim().split(/\r?\n/)[0]!
      return cachedPsPath
    }
  } catch {}

  cachedPsPath = null
  return null
}
