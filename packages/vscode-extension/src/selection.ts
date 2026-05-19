import * as vscode from 'vscode'

export function createSelectionTracker(onSelection: (data: any) => void): vscode.Disposable[] {
  let timer: ReturnType<typeof setTimeout> | undefined

  const selectionDisposable = vscode.window.onDidChangeTextEditorSelection((e) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const editor = e.textEditor
      const selection = editor.selection
      const filePath = editor.document.uri.fsPath
      if (selection.isEmpty) {
        // No text selected — send filePath only (active file info)
        onSelection({ filePath, text: null, selection: null })
        return
      }
      const text = editor.document.getText(selection)
      onSelection({
        filePath,
        text,
        selection: {
          start: { line: selection.start.line + 1, character: selection.start.character },
          end: { line: selection.end.line + 1, character: selection.end.character },
        },
      })
    }, 300)
  })

  const editorDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (!editor) return
    const filePath = editor.document.uri.fsPath
    const selection = editor.selection
    if (selection.isEmpty) {
      onSelection({ filePath, text: null, selection: null })
    } else {
      const text = editor.document.getText(selection)
      onSelection({
        filePath,
        text,
        selection: {
          start: { line: selection.start.line + 1, character: selection.start.character },
          end: { line: selection.end.line + 1, character: selection.end.character },
        },
      })
    }
  })

  return [selectionDisposable, editorDisposable]
}
