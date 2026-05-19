package com.jdcagnet.ide.notifications

import com.intellij.openapi.editor.event.SelectionEvent
import com.intellij.openapi.editor.event.SelectionListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import java.util.Timer
import java.util.TimerTask

class SelectionTracker(private val onSelection: (Map<String, Any?>) -> Unit) : SelectionListener {
    private var timer: Timer? = null

    override fun selectionChanged(e: SelectionEvent) {
        timer?.cancel()
        timer = Timer()
        timer?.schedule(object : TimerTask() {
            override fun run() {
                val editor = e.editor
                val document = editor.document
                val vf = FileDocumentManager.getInstance().getFile(document)
                val selectionModel = editor.selectionModel
                val text = selectionModel.selectedText

                onSelection(mapOf(
                    "filePath" to vf?.path,
                    "text" to text,
                    "selection" to if (text != null) mapOf(
                        "start" to mapOf("line" to editor.caretModel.logicalPosition.line, "character" to 0),
                        "end" to mapOf("line" to editor.caretModel.logicalPosition.line, "character" to 0)
                    ) else null
                ))
            }
        }, 500)
    }
}
