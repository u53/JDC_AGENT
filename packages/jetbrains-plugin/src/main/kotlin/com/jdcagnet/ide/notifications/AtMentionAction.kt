package com.jdcagnet.ide.notifications

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.fileEditor.FileDocumentManager

class AtMentionAction : AnAction() {
    companion object {
        var onMention: ((Map<String, Any?>) -> Unit)? = null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val vf = FileDocumentManager.getInstance().getFile(editor.document) ?: return
        val selection = editor.selectionModel

        onMention?.invoke(mapOf(
            "filePath" to vf.path,
            "lineStart" to (selection.selectionStart.let { editor.document.getLineNumber(it) + 1 }),
            "lineEnd" to (selection.selectionEnd.let { editor.document.getLineNumber(it) + 1 })
        ))
    }
}
