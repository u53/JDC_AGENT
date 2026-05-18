import { existsSync } from 'node:fs'
import { exec } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'

interface AppDef {
  id: string
  name: string
  bundleNames: string[]
  openCommand: (cwd: string) => string
  alwaysAvailable?: boolean
}

const APP_DEFS: AppDef[] = [
  { id: 'vscode', name: 'VS Code', bundleNames: ['Visual Studio Code.app'], openCommand: (cwd) => `code "${cwd}"` },
  { id: 'cursor', name: 'Cursor', bundleNames: ['Cursor.app'], openCommand: (cwd) => `cursor "${cwd}"` },
  { id: 'windsurf', name: 'Windsurf', bundleNames: ['Windsurf.app'], openCommand: (cwd) => `open -a Windsurf "${cwd}"` },
  { id: 'zed', name: 'Zed', bundleNames: ['Zed.app'], openCommand: (cwd) => `zed "${cwd}"` },
  { id: 'intellij', name: 'IntelliJ IDEA', bundleNames: ['IntelliJ IDEA.app', 'IntelliJ IDEA CE.app'], openCommand: (cwd) => `idea "${cwd}"` },
  { id: 'webstorm', name: 'WebStorm', bundleNames: ['WebStorm.app'], openCommand: (cwd) => `webstorm "${cwd}"` },
  { id: 'pycharm', name: 'PyCharm', bundleNames: ['PyCharm.app', 'PyCharm CE.app'], openCommand: (cwd) => `pycharm "${cwd}"` },
  { id: 'goland', name: 'GoLand', bundleNames: ['GoLand.app'], openCommand: (cwd) => `goland "${cwd}"` },
  { id: 'clion', name: 'CLion', bundleNames: ['CLion.app'], openCommand: (cwd) => `clion "${cwd}"` },
  { id: 'xcode', name: 'Xcode', bundleNames: ['Xcode.app'], openCommand: (cwd) => `open -a Xcode "${cwd}"` },
  { id: 'iterm', name: 'iTerm2', bundleNames: ['iTerm.app'], openCommand: (cwd) => `open -a iTerm "${cwd}"` },
  { id: 'terminal', name: 'Terminal', bundleNames: [], openCommand: (cwd) => `open -a Terminal "${cwd}"`, alwaysAvailable: true },
  { id: 'finder', name: 'Finder', bundleNames: [], openCommand: (cwd) => `open "${cwd}"`, alwaysAvailable: true },
]

export class AppLauncher {
  private cache: Array<{ id: string; name: string; available: boolean }> | null = null

  detect(): Array<{ id: string; name: string; available: boolean }> {
    if (this.cache) return this.cache

    const searchDirs = ['/Applications', path.join(homedir(), 'Applications')]

    this.cache = APP_DEFS.map((app) => {
      if (app.alwaysAvailable) return { id: app.id, name: app.name, available: true }
      const found = app.bundleNames.some((bundle) =>
        searchDirs.some((dir) => existsSync(path.join(dir, bundle)))
      )
      return { id: app.id, name: app.name, available: found }
    }).filter((a) => a.available)

    return this.cache
  }

  open(appId: string, cwd: string): Promise<{ success: boolean; error?: string }> {
    const app = APP_DEFS.find((a) => a.id === appId)
    if (!app) return Promise.resolve({ success: false, error: 'Unknown app' })

    return new Promise((resolve) => {
      exec(app.openCommand(cwd), (err) => {
        if (err) resolve({ success: false, error: err.message })
        else resolve({ success: true })
      })
    })
  }
}
