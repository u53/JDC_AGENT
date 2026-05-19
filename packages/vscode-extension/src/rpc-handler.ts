import * as vscode from 'vscode'
import { setDiffContent, clearDiffContent } from './diff-provider'

const openDiffTabs = new Map<string, { resolve: (result: any) => void }>()

export async function handleOpenFile(params: any): Promise<any> {
  const uri = vscode.Uri.file(params.filePath)
  const doc = await vscode.workspace.openTextDocument(uri)
  const editor = await vscode.window.showTextDocument(doc)
  if (params.line) {
    const pos = new vscode.Position((params.line || 1) - 1, (params.column || 1) - 1)
    editor.selection = new vscode.Selection(pos, pos)
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter)
  }
  return { success: true }
}

export function handleOpenDiff(params: any): Promise<any> {
  return new Promise(async (resolve) => {
    const tabName = params.tabName || '[JDC Code] diff'
    const originalUri = setDiffContent(`original-${tabName}`, params.originalContent)
    const proposedUri = setDiffContent(`proposed-${tabName}`, params.proposedContent)

    openDiffTabs.set(tabName, { resolve })

    await vscode.commands.executeCommand('vscode.diff', originalUri, proposedUri, tabName)
  })
}

export function handleCloseTab(params: any): any {
  const tabName = params.tabName
  const pending = openDiffTabs.get(tabName)
  if (pending) {
    pending.resolve({ action: 'closed' })
    openDiffTabs.delete(tabName)
  }
  clearDiffContent(`original-${tabName}`)
  clearDiffContent(`proposed-${tabName}`)
  return { success: true }
}

export function handleCloseAllDiffTabs(): any {
  let closed = 0
  for (const [tabName, pending] of openDiffTabs) {
    pending.resolve({ action: 'closed' })
    clearDiffContent(`original-${tabName}`)
    clearDiffContent(`proposed-${tabName}`)
    closed++
  }
  openDiffTabs.clear()
  return { closed }
}

export function handleGetDiagnostics(params: any): any {
  const files = (params.filePaths || []).map((filePath: string) => {
    const uri = vscode.Uri.file(filePath)
    const diagnostics = vscode.languages.getDiagnostics(uri)
    return {
      filePath,
      diagnostics: diagnostics.map(d => ({
        message: d.message,
        severity: d.severity === 0 ? 'error' : d.severity === 1 ? 'warning' : d.severity === 2 ? 'info' : 'hint',
        range: {
          start: { line: d.range.start.line, character: d.range.start.character },
          end: { line: d.range.end.line, character: d.range.end.character },
        },
        source: d.source,
        code: typeof d.code === 'object' ? String(d.code.value) : d.code ? String(d.code) : undefined,
      })),
    }
  })
  return { files }
}
