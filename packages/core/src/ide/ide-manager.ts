import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { IdeClient } from './ide-client.js'
import { scanLockfiles, isLockfileValid, matchesWorkspace, removeStaleLockfile } from './lockfile.js'
import type { IdeConnection, IdeCallbacks, OpenDiffParams, OpenDiffResult, DiagnosticFile } from './types.js'

const IDE_DIR = join(homedir(), '.jdcagnet', 'ide')
const SCAN_INTERVAL = 5000
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]

export class IdeManager {
  private clients = new Map<number, IdeClient>()
  private connections = new Map<number, IdeConnection>()
  private scanTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimers = new Map<number, ReturnType<typeof setTimeout>>()
  private reconnectAttempts = new Map<number, number>()
  private cwd = ''

  constructor(private callbacks: IdeCallbacks) {
    mkdirSync(IDE_DIR, { recursive: true })
  }

  startDiscovery(cwd: string): void {
    this.cwd = cwd
    this.scan()
    this.scanTimer = setInterval(() => this.scan(), SCAN_INTERVAL)
  }

  stopDiscovery(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer)
      this.scanTimer = null
    }
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer)
    this.reconnectTimers.clear()
  }

  getConnections(): IdeConnection[] {
    return Array.from(this.connections.values())
  }

  isConnected(): boolean {
    return Array.from(this.connections.values()).some(c => c.status === 'connected')
  }

  async openFile(filePath: string, line?: number, column?: number): Promise<void> {
    const client = this.getActiveClient()
    if (!client) throw new Error('No IDE connected')
    await client.call('openFile', { filePath, line, column })
  }

  async openDiff(params: OpenDiffParams): Promise<OpenDiffResult> {
    const client = this.getActiveClient()
    if (!client) throw new Error('No IDE connected')
    return client.call('openDiff', params as unknown as Record<string, unknown>) as Promise<OpenDiffResult>
  }

  async closeAllDiffTabs(): Promise<void> {
    const client = this.getActiveClient()
    if (!client) return
    await client.call('closeAllDiffTabs', {})
  }

  async getDiagnostics(filePaths: string[]): Promise<DiagnosticFile[]> {
    const client = this.getActiveClient()
    if (!client) throw new Error('No IDE connected')
    const result = await client.call('getDiagnostics', { filePaths })
    return result.files || []
  }

  shutdown(): void {
    this.stopDiscovery()
    for (const client of this.clients.values()) client.disconnect()
    this.clients.clear()
    this.connections.clear()
  }

  private scan(): void {
    const lockfiles = scanLockfiles(IDE_DIR)

    for (const { port, path: filePath, lockfile } of lockfiles) {
      if (!isLockfileValid(lockfile)) {
        removeStaleLockfile(filePath)
        this.removeConnection(port)
        continue
      }
      if (!matchesWorkspace(lockfile, this.cwd)) continue
      if (this.clients.has(port)) continue

      this.connectToIde(port, lockfile.authToken, {
        ideId: lockfile.ideId,
        ideName: lockfile.ideName,
        ideVersion: lockfile.ideVersion,
        appName: lockfile.appName,
        uriScheme: lockfile.uriScheme,
        workspaceFolders: lockfile.workspaceFolders,
      })
    }

    for (const port of this.clients.keys()) {
      if (!lockfiles.some(l => l.port === port)) {
        this.removeConnection(port)
      }
    }
  }

  private async connectToIde(
    port: number,
    authToken: string,
    info: Omit<IdeConnection, 'port' | 'status'>,
  ): Promise<void> {
    const client = new IdeClient(port, authToken, {
      onStatusChanged: (status) => {
        this.connections.set(port, { port, ...info, status })
        this.callbacks.onConnectionChanged(this.getConnections())

        if (status === 'connected') {
          this.reconnectAttempts.delete(port)
        }
        if (status === 'disconnected' || status === 'error') {
          this.scheduleReconnect(port, authToken, info)
        }
      },
      onSelectionChanged: (data) => this.callbacks.onSelectionChanged(data),
      onAtMentioned: (data) => this.callbacks.onAtMentioned(data),
    })

    this.clients.set(port, client)
    this.connections.set(port, { port, ...info, status: 'connecting' })
    this.callbacks.onConnectionChanged(this.getConnections())

    try {
      await client.connect()
    } catch (err) {
      console.error(`[ide] connect failed port=${port} ide=${info.ideName}:`, err)
      // Note: do NOT delete this.clients[port] here. scheduleReconnect (triggered
      // by the 'error' status above) needs the client instance to retry. The
      // entry is removed by removeConnection() when scan() detects the lockfile
      // is gone, or by RECONNECT_DELAYS exhaustion via stale-cleanup downstream.
    }
  }

  private scheduleReconnect(port: number, authToken: string, info: Omit<IdeConnection, 'port' | 'status'>): void {
    const attempts = this.reconnectAttempts.get(port) || 0
    if (attempts >= RECONNECT_DELAYS.length) return

    const delay = RECONNECT_DELAYS[attempts]
    this.reconnectAttempts.set(port, attempts + 1)

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(port)
      const client = this.clients.get(port)
      if (!client) return
      try {
        await client.connect()
      } catch (err) {
        console.error(`[ide] reconnect failed port=${port} attempt=${attempts + 1}:`, err)
      }
    }, delay)
    this.reconnectTimers.set(port, timer)
  }

  private removeConnection(port: number): void {
    const client = this.clients.get(port)
    if (client) client.disconnect()
    this.clients.delete(port)
    this.connections.delete(port)
    const timer = this.reconnectTimers.get(port)
    if (timer) clearTimeout(timer)
    this.reconnectTimers.delete(port)
    this.reconnectAttempts.delete(port)
    this.callbacks.onConnectionChanged(this.getConnections())
  }

  private getActiveClient(): IdeClient | null {
    for (const client of this.clients.values()) {
      if (client.connectionStatus === 'connected') return client
    }
    return null
  }
}
