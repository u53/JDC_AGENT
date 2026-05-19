import * as vscode from 'vscode'

const SCHEME = 'jdcagnet-diff'
const contents = new Map<string, string>()

export const diffContentProvider: vscode.TextDocumentContentProvider = {
  provideTextDocumentContent(uri: vscode.Uri): string {
    return contents.get(uri.path) || ''
  },
}

export function setDiffContent(key: string, content: string): vscode.Uri {
  contents.set(key, content)
  return vscode.Uri.parse(`${SCHEME}:${key}`)
}

export function clearDiffContent(key: string): void {
  contents.delete(key)
}

export const DIFF_SCHEME = SCHEME
