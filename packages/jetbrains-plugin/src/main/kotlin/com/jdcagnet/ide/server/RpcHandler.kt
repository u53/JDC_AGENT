package com.jdcagnet.ide.server

import com.google.gson.JsonObject
import com.jdcagnet.ide.handlers.OpenFileHandler
import com.jdcagnet.ide.handlers.DiagnosticsHandler

class RpcHandler(
    private val authToken: String,
    private val openFileHandler: OpenFileHandler,
    private val diagnosticsHandler: DiagnosticsHandler
) {
    fun handle(method: String, params: JsonObject): Any {
        return when (method) {
            "initialize" -> handleInitialize(params)
            "openFile" -> openFileHandler.handle(params)
            "getDiagnostics" -> diagnosticsHandler.handle(params)
            "closeTab" -> mapOf("success" to true)
            "closeAllDiffTabs" -> mapOf("closed" to 0)
            else -> throw IllegalArgumentException("Unknown method: $method")
        }
    }

    private fun handleInitialize(params: JsonObject): Map<String, Any> {
        val token = params.get("authToken")?.asString
        if (token != authToken) throw SecurityException("Invalid auth token")
        return mapOf(
            "ideName" to "IntelliJ IDEA",
            "ideVersion" to "2024.1",
            "capabilities" to listOf("openFile", "getDiagnostics", "selection", "atMention")
        )
    }
}
