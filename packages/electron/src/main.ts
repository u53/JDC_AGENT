import { app, BrowserWindow, nativeImage, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { createMainWindow } from './window.js'
import { SessionManager } from './session-manager.js'
import { registerIpcHandlers } from './ipc-handlers.js'
import { registerMcpIpcHandlers } from './mcp-ipc.js'
import { GitService } from './git-service.js'
import { AppLauncher } from './app-launcher.js'
import { TerminalService } from './terminal-service.js'

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

  ipcMain.handle('updater:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      return { version: result?.updateInfo.version || null }
    } catch (err: any) {
      return { version: null, error: err.message }
    }
  })
  ipcMain.handle('updater:download', async () => {
    autoUpdater.downloadUpdate()
    return { success: true }
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
    // Check for updates on launch (non-blocking)
    autoUpdater.checkForUpdates().catch(() => {})
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
