import type { BrowserWindow } from 'electron'

// node-pty is external (native addon), require at runtime
const pty = require('node-pty')

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

  create(cwd: string): { id: string } {
    const id = `term-${this.nextId++}`
    const shell = process.env.SHELL || '/bin/zsh'

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
    })

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
