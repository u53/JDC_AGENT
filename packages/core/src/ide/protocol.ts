type NotificationHandler = (params: any) => void

interface PendingRequest {
  resolve: (result: any) => void
  reject: (error: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

export class JsonRpcProtocol {
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private notificationHandlers = new Map<string, NotificationHandler[]>()

  createRequest(method: string, params: Record<string, unknown>): { message: string; id: number } {
    const id = this.nextId++
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    return { message, id }
  }

  createNotification(method: string, params: Record<string, unknown>): string {
    return JSON.stringify({ jsonrpc: '2.0', method, params })
  }

  createResponse(id: number, result: unknown): string {
    return JSON.stringify({ jsonrpc: '2.0', id, result })
  }

  createErrorResponse(id: number, code: number, message: string): string {
    return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
  }

  waitForResponse(id: number, timeoutMs = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC request ${id} timeout`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
    })
  }

  onNotification(method: string, handler: NotificationHandler): void {
    const handlers = this.notificationHandlers.get(method) || []
    handlers.push(handler)
    this.notificationHandlers.set(method, handlers)
  }

  handleMessage(raw: string): void {
    let msg: any
    try { msg = JSON.parse(raw) } catch { return }

    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pending.get(msg.id)
      if (!pending) return
      this.pending.delete(msg.id)
      if (pending.timer) clearTimeout(pending.timer)
      if (msg.error) {
        pending.reject(new Error(msg.error.message || 'RPC error'))
      } else {
        pending.resolve(msg.result)
      }
    } else if (msg.method && msg.id === undefined) {
      const handlers = this.notificationHandlers.get(msg.method)
      if (handlers) {
        for (const h of handlers) h(msg.params)
      }
    }
  }

  clearPending(): void {
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer)
      p.reject(new Error('Connection closed'))
    }
    this.pending.clear()
  }
}
