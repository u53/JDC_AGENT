package com.jdcagnet.ide

import com.intellij.ide.AppLifecycleListener
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.project.ProjectManager
import com.jdcagnet.ide.handlers.DiagnosticsHandler
import com.jdcagnet.ide.handlers.OpenFileHandler
import com.jdcagnet.ide.notifications.AtMentionAction
import com.jdcagnet.ide.notifications.SelectionTracker
import com.jdcagnet.ide.server.IdeWebSocketServer
import com.jdcagnet.ide.server.LockfileManager
import com.jdcagnet.ide.server.RpcHandler

class JdcagnetPlugin : AppLifecycleListener {
    private var server: IdeWebSocketServer? = null
    private var lockfile: LockfileManager? = null

    override fun appFrameCreated(commandLineArgs: MutableList<String>) {
        lockfile = LockfileManager()
        val rpcHandler = RpcHandler(lockfile!!.authToken, OpenFileHandler(), DiagnosticsHandler())
        server = IdeWebSocketServer(rpcHandler)

        val port = server!!.start()
        val workspaceFolders = ProjectManager.getInstance().openProjects.map { it.basePath ?: "" }.filter { it.isNotEmpty() }
        lockfile!!.write(port, workspaceFolders)

        val tracker = SelectionTracker { data -> server?.sendNotification("selection_changed", data) }
        EditorFactory.getInstance().eventMulticaster.addSelectionListener(tracker) {}

        AtMentionAction.onMention = { data -> server?.sendNotification("at_mentioned", data) }
    }

    override fun appWillBeClosed(isRestart: Boolean) {
        server?.stop()
        lockfile?.remove()
    }
}
