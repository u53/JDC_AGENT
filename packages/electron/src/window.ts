import { BrowserWindow, globalShortcut } from 'electron'
import path from 'node:path'

let mainWindow: BrowserWindow | null = null

export function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, 'preload.js')
  console.log('[JDCAGNET] Preload path:', preloadPath)

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../ui/index.html'))
  }

  // Register keyboard shortcut to toggle DevTools
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (
      input.type === 'keyDown' &&
      ((input.meta && input.shift && input.key === 'i') ||
        (input.control && input.shift && input.key === 'I'))
    ) {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
