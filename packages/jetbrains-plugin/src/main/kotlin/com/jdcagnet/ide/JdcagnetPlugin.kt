package com.jdcagnet.ide

import com.intellij.ide.AppLifecycleListener
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.project.ProjectManagerListener
import com.jdcagnet.ide.handlers.DiagnosticsHandler
import com.jdcagnet.ide.handlers.OpenFileHandler
import com.jdcagnet.ide.notifications.AtMentionAction
import com.jdcagnet.ide.notifications.SelectionTracker
import com.jdcagnet.ide.server.IdeWebSocketServer
import com.jdcagnet.ide.server.LockfileManager
import com.jdcagnet.ide.server.RpcHandler
import java.util.Timer
import java.util.TimerTask

class JdcagnetPlugin : AppLifecycleListener {
    private var server: IdeWebSocketServer? = null
    private var lockfile: LockfileManager? = null
    private var productInfo: IdeProductInfo? = null

    override fun appFrameCreated(commandLineArgs: MutableList<String>) {
        productInfo = currentIdeProductInfo()
        lockfile = LockfileManager()
        val rpcHandler = RpcHandler(lockfile!!.authToken, productInfo!!, OpenFileHandler(), DiagnosticsHandler())
        server = IdeWebSocketServer(rpcHandler)

        val port = server!!.start()

        // Delay lockfile write to allow projects to load
        Timer().schedule(object : TimerTask() {
            override fun run() {
                writeLockfile(port)
            }
        }, 2000)

        // Also update lockfile when projects open/close
        ApplicationManager.getApplication().messageBus.connect()
            .subscribe(ProjectManager.TOPIC, object : ProjectManagerListener {
                override fun projectOpened(project: Project) {
                    writeLockfile(port)
                }
                override fun projectClosed(project: Project) {
                    writeLockfile(port)
                }
            })

        val tracker = SelectionTracker { data -> server?.sendNotification("selection_changed", data) }
        EditorFactory.getInstance().eventMulticaster.addSelectionListener(tracker) {}

        AtMentionAction.onMention = { data -> server?.sendNotification("at_mentioned", data) }
    }

    override fun appWillBeClosed(isRestart: Boolean) {
        server?.stop()
        lockfile?.remove()
    }

    private fun writeLockfile(port: Int) {
        val workspaceFolders = ProjectManager.getInstance().openProjects
            .mapNotNull { it.basePath }
            .filter { it.isNotEmpty() }
        lockfile?.write(port, workspaceFolders, productInfo ?: currentIdeProductInfo())
    }
}
