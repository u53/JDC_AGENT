export interface IdeLockfile {
  workspaceFolders: string[]
  pid: number
  ideId?: string
  ideName: string
  ideVersion?: string
  appName?: string
  uriScheme?: string
  authToken: string
  version: string
  timestamp: number
}

export interface IdeConnection {
  port: number
  ideId?: string
  ideName: string
  ideVersion?: string
  appName?: string
  uriScheme?: string
  workspaceFolders: string[]
  status: IdeConnectionStatus
}

export type IdeConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface SelectionData {
  filePath?: string
  text?: string
  selection?: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  } | null
}

export interface AtMentionData {
  filePath: string
  lineStart?: number
  lineEnd?: number
}

export interface OpenDiffParams {
  filePath: string
  originalContent: string
  proposedContent: string
  tabName: string
}

export interface OpenDiffResult {
  action: 'saved' | 'closed' | 'rejected'
  content?: string
}

export interface Diagnostic {
  message: string
  severity: 'error' | 'warning' | 'info' | 'hint'
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  source?: string
  code?: string
}

export interface DiagnosticFile {
  filePath: string
  diagnostics: Diagnostic[]
}

export interface IdeCallbacks {
  onConnectionChanged: (connections: IdeConnection[]) => void
  onSelectionChanged: (data: SelectionData) => void
  onAtMentioned: (data: AtMentionData) => void
}
