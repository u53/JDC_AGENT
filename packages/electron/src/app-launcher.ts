import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'

interface CmdDef {
  cmd: string
  args: string[]
  options?: { cwd?: string }
}

interface AppDef {
  id: string
  name: string
  shortName: string
  bundleNames: string[]
  getCmd: (cwd: string) => CmdDef
  alwaysAvailable?: boolean
  winPaths?: string[]
  winGetCmd?: (cwd: string) => CmdDef
}

const APP_DEFS: AppDef[] = [
  {
    id: 'vscode', name: 'VS Code', shortName: 'VS',
    bundleNames: ['Visual Studio Code.app'],
    getCmd: (cwd) => ({ cmd: 'code', args: [cwd] }),
    winPaths: ['Microsoft VS Code\\Code.exe'],
    winGetCmd: (cwd) => ({ cmd: 'code', args: [cwd] }),
  },
  {
    id: 'cursor', name: 'Cursor', shortName: 'Cu',
    bundleNames: ['Cursor.app'],
    getCmd: (cwd) => ({ cmd: 'cursor', args: [cwd] }),
    winGetCmd: (cwd) => ({ cmd: 'cursor', args: [cwd] }),
  },
  {
    id: 'windsurf', name: 'Windsurf', shortName: 'Ws',
    bundleNames: ['Windsurf.app'],
    getCmd: (cwd) => ({ cmd: 'open', args: ['-a', 'Windsurf', cwd] }),
    winGetCmd: (cwd) => ({ cmd: 'windsurf', args: [cwd] }),
  },
  {
    id: 'zed', name: 'Zed', shortName: 'Ze',
    bundleNames: ['Zed.app'],
    getCmd: (cwd) => ({ cmd: 'zed', args: [cwd] }),
  },
  {
    id: 'intellij', name: 'IntelliJ IDEA', shortName: 'IJ',
    bundleNames: ['IntelliJ IDEA.app', 'IntelliJ IDEA CE.app'],
    getCmd: (cwd) => ({ cmd: 'idea', args: [cwd] }),
    winPaths: ['JetBrains\\IntelliJ IDEA*\\bin\\idea64.exe'],
    winGetCmd: (cwd) => ({ cmd: 'idea', args: [cwd] }),
  },
  {
    id: 'webstorm', name: 'WebStorm', shortName: 'WS',
    bundleNames: ['WebStorm.app'],
    getCmd: (cwd) => ({ cmd: 'webstorm', args: [cwd] }),
    winGetCmd: (cwd) => ({ cmd: 'webstorm', args: [cwd] }),
  },
  {
    id: 'pycharm', name: 'PyCharm', shortName: 'PC',
    bundleNames: ['PyCharm.app', 'PyCharm CE.app'],
    getCmd: (cwd) => ({ cmd: 'pycharm', args: [cwd] }),
    winGetCmd: (cwd) => ({ cmd: 'pycharm', args: [cwd] }),
  },
  {
    id: 'goland', name: 'GoLand', shortName: 'GL',
    bundleNames: ['GoLand.app'],
    getCmd: (cwd) => ({ cmd: 'goland', args: [cwd] }),
    winGetCmd: (cwd) => ({ cmd: 'goland', args: [cwd] }),
  },
  {
    id: 'clion', name: 'CLion', shortName: 'CL',
    bundleNames: ['CLion.app'],
    getCmd: (cwd) => ({ cmd: 'clion', args: [cwd] }),
    winGetCmd: (cwd) => ({ cmd: 'clion', args: [cwd] }),
  },
  {
    id: 'xcode', name: 'Xcode', shortName: 'Xc',
    bundleNames: ['Xcode.app'],
    getCmd: (cwd) => ({ cmd: 'open', args: ['-a', 'Xcode', cwd] }),
  },
  {
    id: 'iterm', name: 'iTerm2', shortName: 'iT',
    bundleNames: ['iTerm.app'],
    getCmd: (cwd) => ({ cmd: 'open', args: ['-a', 'iTerm', cwd] }),
  },
  {
    id: 'terminal', name: 'Terminal', shortName: 'Te',
    bundleNames: ['Terminal.app'],
    getCmd: (cwd) => ({ cmd: 'open', args: ['-a', 'Terminal', cwd] }),
    alwaysAvailable: true,
    winGetCmd: (cwd) => ({ cmd: 'cmd', args: ['/C', 'start', 'cmd', '/K'], options: { cwd } }),
  },
  {
    id: 'finder',
    name: process.platform === 'win32' ? 'Explorer' : 'Finder',
    shortName: process.platform === 'win32' ? 'Ex' : 'Fi',
    bundleNames: ['Finder.app'],
    getCmd: (cwd) => ({ cmd: 'open', args: [cwd] }),
    alwaysAvailable: true,
    winGetCmd: (cwd) => ({ cmd: 'explorer', args: [cwd] }),
  },
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
          return appDef.winGetCmd !== undefined
        }
        return appDef.winPaths.some((wp) =>
          programDirs.some((dir) => existsSync(path.join(dir, wp.replace('*', ''))))
        )
      }).filter((a) => a.getCmd || a.winGetCmd)
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

    const def = process.platform === 'win32' && appDef.winGetCmd
      ? appDef.winGetCmd(cwd)
      : appDef.getCmd(cwd)

    return new Promise((resolve) => {
      execFile(def.cmd, def.args, def.options || {}, (err) => {
        if (err) resolve({ success: false, error: err.message })
        else resolve({ success: true })
      })
    })
  }
}
