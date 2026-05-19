import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { v4 as uuid } from 'uuid'

const IDE_DIR = join(homedir(), '.jdcagnet', 'ide')

export class LockfileManager {
  private filePath: string | null = null
  readonly authToken = uuid()

  write(port: number, workspaceFolders: string[]): void {
    mkdirSync(IDE_DIR, { recursive: true })
    this.filePath = join(IDE_DIR, `${port}.lock`)
    const content = JSON.stringify({
      workspaceFolders,
      pid: process.pid,
      ideName: 'VS Code',
      authToken: this.authToken,
      version: '0.1.0',
      timestamp: Date.now(),
    }, null, 2)
    writeFileSync(this.filePath, content)
  }

  remove(): void {
    if (this.filePath) {
      try { unlinkSync(this.filePath) } catch {}
      this.filePath = null
    }
  }
}
