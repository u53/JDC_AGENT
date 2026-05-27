import { spawn, type ChildProcess } from 'node:child_process'

export class LspClient {
  private process: ChildProcess | null = null
  private requestId = 0
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private buffer = ''
  private contentLength = -1

  async start(command: string, args: string[], cwd: string): Promise<void> {
    // On Windows, npm-installed binaries are .cmd files that cannot be spawned
    // directly without shell: true. This is safe here because the command comes
    // from our own SERVER_CONFIGS, not user input.
    const isWindows = process.platform === 'win32'
    this.process = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: isWindows,
      windowsHide: true,
    })

    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString()
      this.parseMessages()
    })

    this.process.on('error', (err) => {
      for (const [, { reject }] of this.pending) {
        reject(err)
      }
      this.pending.clear()
    })

    this.process.on('exit', () => {
      for (const [, { reject }] of this.pending) {
        reject(new Error('LSP server exited'))
      }
      this.pending.clear()
    })
  }

  request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`LSP request '${method}' timed out after 10s`))
      }, 10000)

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout)
          resolve(value)
        },
        reject: (err) => {
          clearTimeout(timeout)
          reject(err)
        },
      })

      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  stop(): void {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
    for (const [, { reject }] of this.pending) {
      reject(new Error('LSP client stopped'))
    }
    this.pending.clear()
  }

  private send(message: object): void {
    if (!this.process?.stdin?.writable) {
      throw new Error('LSP server not running')
    }
    const body = JSON.stringify(message)
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`
    this.process.stdin.write(header + body)
  }

  private parseMessages(): void {
    while (true) {
      if (this.contentLength === -1) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n')
        if (headerEnd === -1) return
        const header = this.buffer.slice(0, headerEnd)
        const match = header.match(/Content-Length:\s*(\d+)/i)
        if (!match) {
          this.buffer = this.buffer.slice(headerEnd + 4)
          continue
        }
        this.contentLength = parseInt(match[1], 10)
        this.buffer = this.buffer.slice(headerEnd + 4)
      }

      if (this.buffer.length < this.contentLength) return

      const body = this.buffer.slice(0, this.contentLength)
      this.buffer = this.buffer.slice(this.contentLength)
      this.contentLength = -1

      try {
        const msg = JSON.parse(body)
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id)!
          this.pending.delete(msg.id)
          if (msg.error) {
            reject(new Error(msg.error.message || 'LSP error'))
          } else {
            resolve(msg.result)
          }
        }
      } catch {
        // ignore malformed messages
      }
    }
  }
}
