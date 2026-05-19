import * as vscode from 'vscode'
import { IdeServer } from './server'
import { LockfileManager } from './lockfile'
import { diffContentProvider, DIFF_SCHEME } from './diff-provider'
import { handleOpenFile, handleOpenDiff, handleCloseTab, handleCloseAllDiffTabs, handleGetDiagnostics } from './rpc-handler'
import { createSelectionTracker } from './selection'
import { registerAtMentionCommand } from './at-mention'

let server: IdeServer | null = null
let lockfile: LockfileManager | null = null

export async function activate(context: vscode.ExtensionContext) {
  server = new IdeServer()
  lockfile = new LockfileManager()

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffContentProvider)
  )

  const workspaceFolders = (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath)

  const port = await server.start({
    onInitialize: (_ws, params) => {
      if (params.authToken !== lockfile!.authToken) {
        throw new Error('Invalid auth token')
      }
      return {
        ideName: 'VS Code',
        ideVersion: vscode.version,
        capabilities: ['openFile', 'openDiff', 'getDiagnostics', 'selection', 'atMention'],
      }
    },
    onRequest: async (_ws, method, params) => {
      switch (method) {
        case 'openFile': return handleOpenFile(params)
        case 'openDiff': return handleOpenDiff(params)
        case 'closeTab': return handleCloseTab(params)
        case 'closeAllDiffTabs': return handleCloseAllDiffTabs()
        case 'getDiagnostics': return handleGetDiagnostics(params)
        default: throw new Error(`Unknown method: ${method}`)
      }
    },
  })

  lockfile.write(port, workspaceFolders)

  const selectionDisposables = createSelectionTracker((data) => server?.sendNotification('selection_changed', data))
  context.subscriptions.push(...selectionDisposables)
  context.subscriptions.push(
    registerAtMentionCommand((data) => server?.sendNotification('at_mentioned', data))
  )

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  statusBar.text = '$(plug) JDC Code'
  statusBar.tooltip = `JDC Code IDE server running on port ${port}`
  statusBar.show()
  context.subscriptions.push(statusBar)
}

export function deactivate() {
  server?.stop()
  lockfile?.remove()
}
