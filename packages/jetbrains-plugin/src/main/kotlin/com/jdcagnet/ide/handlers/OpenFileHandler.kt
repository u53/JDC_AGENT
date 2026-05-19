package com.jdcagnet.ide.handlers

import com.google.gson.JsonObject
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.vfs.LocalFileSystem

class OpenFileHandler {
    fun handle(params: JsonObject): Map<String, Any> {
        val filePath = params.get("filePath")?.asString ?: throw IllegalArgumentException("filePath required")
        val line = params.get("line")?.asInt ?: 0
        val column = params.get("column")?.asInt ?: 0

        ApplicationManager.getApplication().invokeLater {
            val vf = LocalFileSystem.getInstance().findFileByPath(filePath) ?: return@invokeLater
            val project = ProjectManager.getInstance().openProjects.firstOrNull() ?: return@invokeLater
            val descriptor = OpenFileDescriptor(project, vf, maxOf(0, line - 1), maxOf(0, column - 1))
            FileEditorManager.getInstance(project).openTextEditor(descriptor, true)
        }
        return mapOf("success" to true)
    }
}
