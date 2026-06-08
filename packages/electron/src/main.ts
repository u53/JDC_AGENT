import { app, BrowserWindow, nativeImage, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import { existsSync, mkdirSync, createWriteStream } from 'node:fs'
import { createMainWindow } from './window.js'
import { SessionManager } from './session-manager.js'
import { registerIpcHandlers } from './ipc-handlers.js'
import { registerMcpIpcHandlers } from './mcp-ipc.js'
import { GitService } from './git-service.js'
import { AppLauncher } from './app-launcher.js'
import { TerminalService } from './terminal-service.js'

// Point the JDC Context Engine at the Tree-sitter wasm assets bundled into dist
// (copied by build.mjs). In dev these resolve from node_modules automatically,
// but setting them is harmless and makes packaged builds deterministic.
const tsRuntimeDir = path.join(__dirname, 'tree-sitter')
if (existsSync(path.join(tsRuntimeDir, 'tree-sitter.wasm'))) {
  process.env.JDC_TREE_SITTER_WASM_DIR = tsRuntimeDir
  process.env.JDC_GRAMMAR_WASM_DIR = path.join(tsRuntimeDir, 'grammars')
}

// Mirror console output to a file so production users can ship logs back.
// Path: %APPDATA%\JDC Code\logs\main.log on Windows, ~/Library/Logs/JDC Code/main.log on macOS.
function setupFileLogger(): void {
  try {
    const logDir = app.getPath('logs')
    mkdirSync(logDir, { recursive: true })
    const logPath = path.join(logDir, 'main.log')
    const stream = createWriteStream(logPath, { flags: 'a' })
    const ts = () => new Date().toISOString()
    const wrap = (orig: (...args: any[]) => void, level: string) => (...args: any[]) => {
      orig(...args)
      try {
        const line = `[${ts()}] [${level}] ${args.map(a => typeof a === 'string' ? a : (a instanceof Error ? `${a.message}\n${a.stack}` : JSON.stringify(a))).join(' ')}\n`
        stream.write(line)
      } catch {}
    }
    console.log   = wrap(console.log.bind(console),   'log')
    console.info  = wrap(console.info.bind(console),  'info')
    console.warn  = wrap(console.warn.bind(console),  'warn')
    console.error = wrap(console.error.bind(console), 'error')
    console.log(`[JDC Code] log file: ${logPath}`)
  } catch (err) {
    // Logger setup must never crash the app.
    process.stderr.write(`[JDC Code] failed to set up file logger: ${err}\n`)
  }
}
setupFileLogger()

process.on('uncaughtException', (err) => {
  console.error('[JDC Code] Uncaught exception:', err.message)
})

const sessionManager = new SessionManager()
const gitService = new GitService()
const appLauncher = new AppLauncher()
const terminalService = new TerminalService()

// Auto-updater setup
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

function setupAutoUpdater(win: BrowserWindow) {
  autoUpdater.on('update-available', (info) => {
    win.webContents.send('updater:available', { version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    win.webContents.send('updater:not-available')
  })
  autoUpdater.on('download-progress', (progress) => {
    win.webContents.send('updater:progress', { percent: Math.round(progress.percent) })
  })
  autoUpdater.on('update-downloaded', () => {
    win.webContents.send('updater:downloaded')
  })
  autoUpdater.on('error', (err) => {
    win.webContents.send('updater:error', { message: err.message })
  })

  // Auto-check on launch (delay 5s) + every 30 minutes
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000)
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 30 * 60 * 1000)

  ipcMain.handle('updater:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      return { version: result?.updateInfo.version || null }
    } catch (err: any) {
      return { version: null, error: err.message }
    }
  })
  ipcMain.handle('updater:download', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })
  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall()
  })
}

ipcMain.handle('app:version', () => app.getVersion())

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    const iconPath = path.join(__dirname, '../../assets/icon.png')
    if (existsSync(iconPath)) {
      app.dock.setIcon(nativeImage.createFromPath(iconPath))
    }
  }

  await sessionManager.ensureReady()
  registerIpcHandlers(sessionManager, { gitService, appLauncher, terminalService })
  registerMcpIpcHandlers(sessionManager)

  const win = createMainWindow()
  sessionManager.setWindow(win)
  terminalService.setWindow(win)
  setupAutoUpdater(win)

  win.webContents.on('did-finish-load', () => {
    sessionManager.initMcp(process.env.HOME || '/').catch((err) => {
      console.error('[JDC Code] MCP init error:', err.message)
    })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createMainWindow()
      sessionManager.setWindow(newWin)
      terminalService.setWindow(newWin)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  terminalService.destroyAll()
  sessionManager.close()
})
