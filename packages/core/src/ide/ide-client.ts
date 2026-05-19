import WebSocket from 'ws'
import { JsonRpcProtocol } from './protocol.js'
import type { IdeConnectionStatus, SelectionData, AtMentionData } from './types.js'

interface IdeClientCallbacks {
  onStatusChanged: (status: IdeConnectionStatus) => void
  onSelectionChanged: (data: SelectionData) => void
  onAtMentioned: (data: AtMentionData) => void
}

export class IdeClient {
  private ws: WebSocket | null = null
  private protocol = new JsonRpcProtocol()
  private status: IdeConnectionStatus = 'disconnected'
  private pingInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    private port: number,
    private authToken: string,
    private callbacks: IdeClientCallbacks
  ) {
    this.protocol.onNotification('selection_changed', (params) => {
      this.callbacks.onSelectionChanged(params as SelectionData)
    })
    this.protocol.onNotification('at_mentioned', (params) => {
      this.callbacks.onAtMentioned(params as AtMentionData)
    })
  }

  get connectionStatus(): IdeConnectionStatus { return this.status }

  async connect(): Promise<void> {
    if (this.ws) return
    this.setStatus('connecting')

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${this.port}`)

      const timeout = setTimeout(() => {
        ws.terminate()
        this.setStatus('error')
        reject(new Error('Connection timeout'))
      }, 5000)

      ws.on('open', async () => {
        clearTimeout(timeout)
        this.ws = ws
        try {
          await this.initialize()
          this.setStatus('connected')
          this.startPing()
          resolve()
        } catch (err) {
          this.ws = null
          ws.close()
          this.setStatus('error')
          reject(err)
        }
      })

      ws.on('message', (data) => {
        this.protocol.handleMessage(data.toString())
      })

      ws.on('close', () => {
        this.cleanup()
        this.setStatus('disconnected')
      })

      ws.on('error', (err) => {
        clearTimeout(timeout)
        this.cleanup()
        this.setStatus('error')
        reject(err)
      })
    })
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.cleanup()
    }
    this.setStatus('disconnected')
  }

  async call(method: string, params: Record<string, unknown>): Promise<any> {
    if (!this.ws || this.status !== 'connected') {
      throw new Error('IDE not connected')
    }
    const { message, id } = this.protocol.createRequest(method, params)
    this.ws.send(message)
    return this.protocol.waitForResponse(id)
  }

  private async initialize(): Promise<void> {
    const { message, id } = this.protocol.createRequest('initialize', {
      clientName: 'jdcagnet',
      clientVersion: '1.0.0',
      authToken: this.authToken,
    })
    this.ws!.send(message)
    await this.protocol.waitForResponse(id, 5000)
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping()
      }
    }, 30000)
  }

  private cleanup(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
    this.protocol.clearPending()
    this.ws = null
  }

  private setStatus(status: IdeConnectionStatus): void {
    this.status = status
    this.callbacks.onStatusChanged(status)
  }
}
