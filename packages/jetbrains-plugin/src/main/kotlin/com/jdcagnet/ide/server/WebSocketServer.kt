package com.jdcagnet.ide.server

import com.google.gson.Gson
import com.google.gson.JsonObject
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.routing.*
import io.ktor.server.websocket.*
import io.ktor.websocket.*
import kotlinx.coroutines.*
import java.net.ServerSocket
import java.util.concurrent.ConcurrentHashMap

class IdeWebSocketServer(private val rpcHandler: RpcHandler) {
    private var server: ApplicationEngine? = null
    private val clients = ConcurrentHashMap.newKeySet<DefaultWebSocketServerSession>()
    private val gson = Gson()
    var port: Int = 0
        private set

    fun start(): Int {
        port = findFreePort()
        server = embeddedServer(Netty, port = port, host = "127.0.0.1") {
            install(WebSockets)
            routing {
                webSocket("/") {
                    clients.add(this)
                    try {
                        for (frame in incoming) {
                            if (frame is Frame.Text) {
                                val response = handleMessage(frame.readText())
                                if (response != null) send(Frame.Text(response))
                            }
                        }
                    } finally {
                        clients.remove(this)
                    }
                }
            }
        }.start(wait = false)
        return port
    }

    fun sendNotification(method: String, params: Any) {
        val msg = gson.toJson(mapOf("jsonrpc" to "2.0", "method" to method, "params" to params))
        runBlocking {
            clients.forEach { session ->
                try { session.send(Frame.Text(msg)) } catch (_: Exception) {}
            }
        }
    }

    fun stop() {
        server?.stop(500, 1000)
        server = null
        clients.clear()
    }

    private suspend fun handleMessage(raw: String): String? {
        val msg = gson.fromJson(raw, JsonObject::class.java) ?: return null
        val method = msg.get("method")?.asString ?: return null
        val id = msg.get("id") ?: return null

        val params = msg.getAsJsonObject("params") ?: JsonObject()
        return try {
            val result = rpcHandler.handle(method, params)
            gson.toJson(mapOf("jsonrpc" to "2.0", "id" to id.asInt, "result" to result))
        } catch (e: Exception) {
            gson.toJson(mapOf("jsonrpc" to "2.0", "id" to id.asInt, "error" to mapOf("code" to -1, "message" to (e.message ?: "error"))))
        }
    }

    private fun findFreePort(): Int {
        ServerSocket(0).use { return it.localPort }
    }
}
