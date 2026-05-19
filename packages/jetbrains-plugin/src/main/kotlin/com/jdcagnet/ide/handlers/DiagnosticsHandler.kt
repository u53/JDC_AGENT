package com.jdcagnet.ide.handlers

import com.google.gson.JsonObject

class DiagnosticsHandler {
    fun handle(params: JsonObject): Map<String, Any> {
        val filePaths = params.getAsJsonArray("filePaths")?.map { it.asString } ?: emptyList()
        val files = filePaths.map { filePath ->
            mapOf("filePath" to filePath, "diagnostics" to emptyList<Any>())
        }
        return mapOf("files" to files)
    }
}
