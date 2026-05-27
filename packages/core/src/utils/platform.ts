import { readFileSync } from 'node:fs'

export type Platform = 'windows' | 'macos' | 'linux' | 'wsl'

let cachedPlatform: Platform | null = null

export function getPlatform(): Platform {
  if (cachedPlatform) return cachedPlatform

  if (process.platform === 'win32') {
    cachedPlatform = 'windows'
  } else if (process.platform === 'darwin') {
    cachedPlatform = 'macos'
  } else if (process.platform === 'linux') {
    try {
      const procVersion = readFileSync('/proc/version', 'utf-8')
      if (procVersion.toLowerCase().includes('microsoft') || procVersion.toLowerCase().includes('wsl')) {
        cachedPlatform = 'wsl'
      } else {
        cachedPlatform = 'linux'
      }
    } catch {
      cachedPlatform = 'linux'
    }
  } else {
    cachedPlatform = 'linux'
  }

  return cachedPlatform
}

export function isWindows(): boolean {
  return getPlatform() === 'windows'
}
