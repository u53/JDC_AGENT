import type { BrowserWindow } from 'electron'

let pty: any = null
try {
  pty = require('node-pty')
} catch (err) {
  console.error('[TerminalService] Failed to load node-pty:', (err as Error).message)
}

interface PtyInstance {
  id: string
  process: any
  cwd: string
}

export class TerminalService {
  private instances = new Map<string, PtyInstance>()
  private window: BrowserWindow | null = null
  private nextId = 1

  setWindow(window: BrowserWindow): void {
    this.window = window
  }

  create(cwd: string): { id: string; error?: string } {
    if (!pty) return { id: '', error: 'node-pty not available' }

    const id = `term-${this.nextId++}`
    const isWindows = process.platform === 'win32'
    const shell = isWindows
      ? process.env.COMSPEC || 'cmd.exe'
      : process.env.SHELL || '/bin/zsh'

    let ptyProcess: any
    try {
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: { ...process.env, ...(isWindows ? {} : { TERM: 'xterm-256color' }) },
        encoding: 'utf8',
        useConpty: isWindows,
      })
    } catch (err) {
      return { id: '', error: (err as Error).message }
    }

    if (isWindows) {
      ptyProcess.write('chcp 65001 > nul\r')
    }

    ptyProcess.onData((data: string) => {
      this.window?.webContents.send('terminal:data', { id, data })
    })

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      this.window?.webContents.send('terminal:exit', { id, code: exitCode })
      this.instances.delete(id)
    })

    this.instances.set(id, { id, process: ptyProcess, cwd })
    return { id }
  }

  write(id: string, data: string): void {
    const instance = this.instances.get(id)
    if (instance) instance.process.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const instance = this.instances.get(id)
    if (instance) instance.process.resize(cols, rows)
  }

  destroy(id: string): { success: boolean } {
    const instance = this.instances.get(id)
    if (instance) {
      instance.process.kill()
      this.instances.delete(id)
      return { success: true }
    }
    return { success: false }
  }

  destroyAll(): void {
    for (const [id] of this.instances) {
      this.destroy(id)
    }
  }
}
