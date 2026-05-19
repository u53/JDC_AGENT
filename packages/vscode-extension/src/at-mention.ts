import * as vscode from 'vscode'

export function registerAtMentionCommand(onMention: (data: any) => void): vscode.Disposable {
  return vscode.commands.registerCommand('jdcagnet.sendToChat', () => {
    const editor = vscode.window.activeTextEditor
    if (!editor) return

    const selection = editor.selection
    const filePath = editor.document.uri.fsPath
    onMention({
      filePath,
      lineStart: selection.start.line + 1,
      lineEnd: selection.end.line + 1,
    })
    vscode.window.showInformationMessage(`Sent to JDC Code: ${filePath.split('/').pop()}`)
  })
}
