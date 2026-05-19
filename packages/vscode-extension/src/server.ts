import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'node:net'

export interface ServerCallbacks {
  onInitialize: (ws: WebSocket, params: any) => any
  onRequest: (ws: WebSocket, method: string, params: any) => Promise<any>
}

export class IdeServer {
  private wss: WebSocketServer | null = null
  private clients = new Set<WebSocket>()
  port = 0

  async start(callbacks: ServerCallbacks): Promise<number> {
    this.port = await this.findFreePort()
    this.wss = new WebSocketServer({ port: this.port, host: '127.0.0.1' })

    this.wss.on('connection', (ws) => {
      this.clients.add(ws)
      ws.on('message', async (raw) => {
        let msg: any
        try { msg = JSON.parse(raw.toString()) } catch { return }

        if (msg.method && msg.id !== undefined) {
          try {
            let result: any
            if (msg.method === 'initialize') {
              result = callbacks.onInitialize(ws, msg.params)
            } else {
              result = await callbacks.onRequest(ws, msg.method, msg.params)
            }
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }))
          } catch (err: any) {
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -1, message: err.message } }))
          }
        }
      })
      ws.on('close', () => { this.clients.delete(ws) })
    })

    return this.port
  }

  sendNotification(method: string, params: any): void {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params })
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg)
    }
  }

  stop(): void {
    for (const ws of this.clients) ws.close()
    this.clients.clear()
    this.wss?.close()
    this.wss = null
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = createServer()
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address() as any
        srv.close(() => resolve(addr.port))
      })
      srv.on('error', reject)
    })
  }
}
