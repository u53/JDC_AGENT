import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window.js'
import { SessionManager } from './session-manager.js'
import { registerIpcHandlers } from './ipc-handlers.js'
import { registerMcpIpcHandlers } from './mcp-ipc.js'

const sessionManager = new SessionManager()

app.whenReady().then(async () => {
  await sessionManager.ensureReady()
  registerIpcHandlers(sessionManager)
  registerMcpIpcHandlers(sessionManager)

  await sessionManager.initMcp(process.env.HOME || '/')

  const win = createMainWindow()
  sessionManager.setWindow(win)

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
