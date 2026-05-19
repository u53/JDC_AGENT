package com.jdcagnet.ide.notifications

import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.editor.event.SelectionEvent
import com.intellij.openapi.editor.event.SelectionListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManagerEvent
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import java.util.Timer
import java.util.TimerTask

class SelectionTracker(private val onSelection: (Map<String, Any?>) -> Unit) : SelectionListener, FileEditorManagerListener {
    private var timer: Timer? = null

    override fun selectionChanged(e: SelectionEvent) {
        timer?.cancel()
        timer = Timer()
        timer?.schedule(object : TimerTask() {
            override fun run() {
                ReadAction.run<Throwable> {
                    val editor = e.editor
                    val document = editor.document
                    val vf = FileDocumentManager.getInstance().getFile(document)
                    val selectionModel = editor.selectionModel
                    val text = selectionModel.selectedText

                    onSelection(mapOf(
                        "filePath" to vf?.path,
                        "text" to text,
                        "selection" to if (text != null) mapOf(
                            "start" to mapOf("line" to (document.getLineNumber(selectionModel.selectionStart) + 1), "character" to 0),
                            "end" to mapOf("line" to (document.getLineNumber(selectionModel.selectionEnd) + 1), "character" to 0)
                        ) else null
                    ))
                }
            }
        }, 300)
    }

    override fun selectionChanged(event: FileEditorManagerEvent) {
        val vf = event.newFile ?: return
        onSelection(mapOf(
            "filePath" to vf.path,
            "text" to null,
            "selection" to null
        ))
    }
}
