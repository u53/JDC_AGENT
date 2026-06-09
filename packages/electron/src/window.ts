import { BrowserWindow, nativeImage } from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'

let mainWindow: BrowserWindow | null = null

export function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, 'preload.js')

  const iconPath = path.join(__dirname, '../../assets/icon.png')

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    autoHideMenuBar: true,
    icon: existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  mainWindow.setMenuBarVisibility(false)
  mainWindow.setMenu(null)

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../ui/index.html'))
  }

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow?.webContents.executeJavaScript('typeof window.electronAPI').then((result) => {
        if (result !== 'object') {
          console.warn('[JDC Code] electronAPI preload unavailable:', result)
        }
      })
    })
  }

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.on('before-input-event', (_event, input) => {
      if (
        input.type === 'keyDown' &&
        ((input.meta && input.shift && input.key === 'i') ||
          (input.control && input.shift && input.key === 'I'))
      ) {
        mainWindow?.webContents.toggleDevTools()
      }
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
