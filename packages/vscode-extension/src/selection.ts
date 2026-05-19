import * as vscode from 'vscode'

export function createSelectionTracker(onSelection: (data: any) => void): vscode.Disposable {
  let timer: ReturnType<typeof setTimeout> | undefined

  return vscode.window.onDidChangeTextEditorSelection((e) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const editor = e.textEditor
      const selection = editor.selection
      if (selection.isEmpty) {
        onSelection({ filePath: editor.document.uri.fsPath, text: undefined, selection: null })
        return
      }
      const text = editor.document.getText(selection)
      onSelection({
        filePath: editor.document.uri.fsPath,
        text,
        selection: {
          start: { line: selection.start.line, character: selection.start.character },
          end: { line: selection.end.line, character: selection.end.character },
        },
      })
    }, 500)
  })
}
