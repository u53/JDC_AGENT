import { existsSync } from 'node:fs'
import { exec } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'

interface AppDef {
  id: string
  name: string
  shortName: string
  bundleNames: string[]
  openCommand: (cwd: string) => string
  alwaysAvailable?: boolean
  winPaths?: string[]
  winCommand?: (cwd: string) => string
}

const APP_DEFS: AppDef[] = [
  { id: 'vscode', name: 'VS Code', shortName: 'VS', bundleNames: ['Visual Studio Code.app'], openCommand: (cwd) => `code "${cwd}"`, winPaths: ['Microsoft VS Code\\Code.exe'], winCommand: (cwd) => `code "${cwd}"` },
  { id: 'cursor', name: 'Cursor', shortName: 'Cu', bundleNames: ['Cursor.app'], openCommand: (cwd) => `cursor "${cwd}"`, winCommand: (cwd) => `cursor "${cwd}"` },
  { id: 'windsurf', name: 'Windsurf', shortName: 'Ws', bundleNames: ['Windsurf.app'], openCommand: (cwd) => `open -a Windsurf "${cwd}"`, winCommand: (cwd) => `windsurf "${cwd}"` },
  { id: 'zed', name: 'Zed', shortName: 'Ze', bundleNames: ['Zed.app'], openCommand: (cwd) => `zed "${cwd}"` },
  { id: 'intellij', name: 'IntelliJ IDEA', shortName: 'IJ', bundleNames: ['IntelliJ IDEA.app', 'IntelliJ IDEA CE.app'], openCommand: (cwd) => `idea "${cwd}"`, winPaths: ['JetBrains\\IntelliJ IDEA*\\bin\\idea64.exe'], winCommand: (cwd) => `idea "${cwd}"` },
  { id: 'webstorm', name: 'WebStorm', shortName: 'WS', bundleNames: ['WebStorm.app'], openCommand: (cwd) => `webstorm "${cwd}"`, winCommand: (cwd) => `webstorm "${cwd}"` },
  { id: 'pycharm', name: 'PyCharm', shortName: 'PC', bundleNames: ['PyCharm.app', 'PyCharm CE.app'], openCommand: (cwd) => `pycharm "${cwd}"`, winCommand: (cwd) => `pycharm "${cwd}"` },
  { id: 'goland', name: 'GoLand', shortName: 'GL', bundleNames: ['GoLand.app'], openCommand: (cwd) => `goland "${cwd}"`, winCommand: (cwd) => `goland "${cwd}"` },
  { id: 'clion', name: 'CLion', shortName: 'CL', bundleNames: ['CLion.app'], openCommand: (cwd) => `clion "${cwd}"`, winCommand: (cwd) => `clion "${cwd}"` },
  { id: 'xcode', name: 'Xcode', shortName: 'Xc', bundleNames: ['Xcode.app'], openCommand: (cwd) => `open -a Xcode "${cwd}"` },
  { id: 'iterm', name: 'iTerm2', shortName: 'iT', bundleNames: ['iTerm.app'], openCommand: (cwd) => `open -a iTerm "${cwd}"` },
  { id: 'terminal', name: 'Terminal', shortName: 'Te', bundleNames: ['Terminal.app'], openCommand: (cwd) => process.platform === 'win32' ? `start cmd /K "cd /d ${cwd}"` : `open -a Terminal "${cwd}"`, alwaysAvailable: true },
  { id: 'finder', name: process.platform === 'win32' ? 'Explorer' : 'Finder', shortName: process.platform === 'win32' ? 'Ex' : 'Fi', bundleNames: ['Finder.app'], openCommand: (cwd) => process.platform === 'win32' ? `explorer "${cwd}"` : `open "${cwd}"`, alwaysAvailable: true },
]

export interface DetectedApp {
  id: string
  name: string
  shortName: string
  available: boolean
}

export class AppLauncher {
  private cache: DetectedApp[] | null = null

  detect(): DetectedApp[] {
    if (this.cache) return this.cache

    if (process.platform === 'darwin') {
      const searchDirs = ['/Applications', path.join(homedir(), 'Applications'), '/System/Applications']
      this.cache = APP_DEFS.filter((appDef) => {
        if (appDef.alwaysAvailable) return true
        return appDef.bundleNames.some((bundle) =>
          searchDirs.some((dir) => existsSync(path.join(dir, bundle)))
        )
      }).map((a) => ({ id: a.id, name: a.name, shortName: a.shortName, available: true }))
    } else if (process.platform === 'win32') {
      const programDirs = [
        process.env['ProgramFiles'] || 'C:\\Program Files',
        process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
        path.join(homedir(), 'AppData', 'Local', 'Programs'),
      ]
      this.cache = APP_DEFS.filter((appDef) => {
        if (appDef.alwaysAvailable) return true
        if (!appDef.winPaths) {
          return appDef.winCommand !== undefined
        }
        return appDef.winPaths.some((wp) =>
          programDirs.some((dir) => existsSync(path.join(dir, wp.replace('*', ''))))
        )
      }).filter((a) => a.openCommand || a.winCommand)
        .map((a) => ({ id: a.id, name: a.name, shortName: a.shortName, available: true }))
    } else {
      this.cache = APP_DEFS.filter((a) => a.alwaysAvailable)
        .map((a) => ({ id: a.id, name: a.name, shortName: a.shortName, available: true }))
    }

    return this.cache
  }

  open(appId: string, cwd: string): Promise<{ success: boolean; error?: string }> {
    const appDef = APP_DEFS.find((a) => a.id === appId)
    if (!appDef) return Promise.resolve({ success: false, error: 'Unknown app' })

    const cmd = process.platform === 'win32' && appDef.winCommand
      ? appDef.winCommand(cwd)
      : appDef.openCommand(cwd)

    return new Promise((resolve) => {
      exec(cmd, (err) => {
        if (err) resolve({ success: false, error: err.message })
        else resolve({ success: true })
      })
    })
  }
}
