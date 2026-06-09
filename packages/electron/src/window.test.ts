import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  windows: [] as any[],
  BrowserWindow: vi.fn((options: any) => {
    const win = {
      options,
      loadFile: vi.fn(),
      loadURL: vi.fn(),
      on: vi.fn(),
      setMenu: vi.fn(),
      setMenuBarVisibility: vi.fn(),
      webContents: {
        on: vi.fn(),
        executeJavaScript: vi.fn(),
        toggleDevTools: vi.fn(),
      },
    }
    mocks.windows.push(win)
    return win
  }),
  createFromPath: vi.fn((filePath: string) => ({ filePath })),
}))

vi.mock('electron', () => ({
  BrowserWindow: mocks.BrowserWindow,
  nativeImage: {
    createFromPath: mocks.createFromPath,
  },
}))

describe('createMainWindow', () => {
  beforeEach(() => {
    mocks.windows.length = 0
    mocks.BrowserWindow.mockClear()
    mocks.createFromPath.mockClear()
    process.env.NODE_ENV = 'test'
  })

  it('hides the native menu bar for the JDC shell', async () => {
    const { createMainWindow } = await import('./window')

    const win = createMainWindow() as any

    expect(mocks.BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
      autoHideMenuBar: true,
    }))
    expect(win.setMenuBarVisibility).toHaveBeenCalledWith(false)
    expect(win.setMenu).toHaveBeenCalledWith(null)
  })
})
