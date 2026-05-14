import { app, BrowserWindow, nativeImage } from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { createMainWindow } from './window.js'
import { SessionManager } from './session-manager.js'
import { registerIpcHandlers } from './ipc-handlers.js'
import { registerMcpIpcHandlers } from './mcp-ipc.js'

process.on('uncaughtException', (err) => {
  console.error('[JDCAGNET] Uncaught exception:', err.message)
})

const sessionManager = new SessionManager()

app.whenReady().then(async () => {
  // Set dock icon on macOS
  if (process.platform === 'darwin') {
    const iconPath = path.join(__dirname, '../../assets/icon.png')
    if (existsSync(iconPath)) {
      app.dock.setIcon(nativeImage.createFromPath(iconPath))
    }
  }

  await sessionManager.ensureReady()
  registerIpcHandlers(sessionManager)
  registerMcpIpcHandlers(sessionManager)

  const win = createMainWindow()
  sessionManager.setWindow(win)

  win.webContents.on('did-finish-load', () => {
    sessionManager.initMcp(process.env.HOME || '/').catch((err) => {
      console.error('[JDCAGNET] MCP init error:', err.message)
    })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createMainWindow()
      sessionManager.setWindow(newWin)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  sessionManager.close()
})
