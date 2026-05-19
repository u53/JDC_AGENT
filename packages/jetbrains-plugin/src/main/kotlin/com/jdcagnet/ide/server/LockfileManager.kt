package com.jdcagnet.ide.server

import com.google.gson.Gson
import java.io.File
import java.util.UUID

class LockfileManager {
    private var lockfile: File? = null
    val authToken: String = UUID.randomUUID().toString()
    private val gson = Gson()

    fun write(port: Int, workspaceFolders: List<String>) {
        val dir = File(System.getProperty("user.home"), ".jdcagnet/ide")
        dir.mkdirs()
        lockfile = File(dir, "$port.lock")
        val content = gson.toJson(mapOf(
            "workspaceFolders" to workspaceFolders,
            "pid" to ProcessHandle.current().pid(),
            "ideName" to "IntelliJ IDEA",
            "authToken" to authToken,
            "version" to "0.1.0",
            "timestamp" to System.currentTimeMillis()
        ))
        lockfile!!.writeText(content)
    }

    fun remove() {
        lockfile?.delete()
        lockfile = null
    }
}
