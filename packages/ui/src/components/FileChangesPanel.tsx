import { useState, useEffect, useCallback } from 'react'
import { useSessionStore } from '../stores/session-store'

interface FileChange {
  filePath: string
  changeType: 'created' | 'modified'
  snapshotCount: number
  lastModified: number
}

interface FileSnapshot {
  id: string
  filePath: string
  contentBefore: string | null
  contentAfter: string
  toolUseId: string
  turnIndex: number
  timestamp: number
}

interface ConfirmState {
  type: 'single' | 'all'
  snapshotId?: string
  message: string
}

export function FileChangesPanel() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const sessionStates = useSessionStore((s) => s.sessionStates)
  const isStreaming = activeSessionId ? sessionStates[activeSessionId]?.isStreaming : false
  const [changes, setChanges] = useState<FileChange[]>([])
  const [expanded, setExpanded] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [history, setHistory] = useState<FileSnapshot[]>([])
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)

  const loadChanges = useCallback(async () => {
    if (!activeSessionId) return
    try {
      const result = await window.electronAPI?.invoke('file:get-changes', { sessionId: activeSessionId })
      if (result) setChanges(result)
    } catch { /* ignore */ }
  }, [activeSessionId])

  useEffect(() => {
    loadChanges()
  }, [loadChanges])

  useEffect(() => {
    if (!isStreaming) loadChanges()
  }, [isStreaming, loadChanges])

  useEffect(() => {
    if (!selectedFile || !activeSessionId) { setHistory([]); return }
    window.electronAPI?.invoke('file:get-history', { sessionId: activeSessionId, filePath: selectedFile })
      .then((result: FileSnapshot[]) => { if (result) setHistory(result) })
      .catch(() => {})
  }, [selectedFile, activeSessionId])

  const executeRewind = async () => {
    if (!activeSessionId || !confirmState) return
    try {
      if (confirmState.type === 'single' && confirmState.snapshotId) {
        await window.electronAPI?.invoke('file:rewind', { sessionId: activeSessionId, snapshotId: confirmState.snapshotId })
      } else {
        await window.electronAPI?.invoke('file:rewind-turn', { sessionId: activeSessionId, turnIndex: 0 })
      }
      await loadChanges()
      setSelectedFile(null)
    } catch (err) {
      console.error('[FileChangesPanel] rewind failed:', err)
    }
    setConfirmState(null)
  }

  const handleAcceptFile = async (filePath: string) => {
    if (!activeSessionId) return
    await window.electronAPI?.invoke('file:accept', { sessionId: activeSessionId, filePath })
    await loadChanges()
  }

  const handleAcceptAll = async () => {
    if (!activeSessionId) return
    await window.electronAPI?.invoke('file:accept-all', { sessionId: activeSessionId })
    await loadChanges()
  }

  if (changes.length === 0) return null

  return (
    <div className="border-t border-[#333]">
      {confirmState && (
        <div className="border-b border-yellow-600/50 bg-yellow-900/10 px-4 py-2">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.1em] mb-2">
            <span className="inline-block h-2 w-2 rounded-full bg-yellow-400" />
            <span className="text-yellow-400">CONFIRM REVERT</span>
          </div>
          <p className="text-xs text-[#EAEAEA] mb-2">{confirmState.message}</p>
          <div className="flex items-center gap-3">
            <button
              onClick={executeRewind}
              className="text-[10px] uppercase tracking-[0.05em] text-[#E61919] hover:text-red-400 transition-colors"
            >
              [CONFIRM]
            </button>
            <button
              onClick={() => setConfirmState(null)}
              className="text-[10px] uppercase tracking-[0.05em] text-[#666] hover:text-[#EAEAEA] transition-colors"
            >
              [CANCEL]
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-1.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-[10px] uppercase tracking-[0.1em] hover:text-[#4AF626] transition-colors"
        >
          <span className="text-[#4AF626]">FILES CHANGED: {changes.length}</span>
          <span className="text-[#666]">{expanded ? '▼' : '▶'}</span>
        </button>
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.1em]">
          <button
            onClick={() => setConfirmState({ type: 'all', message: `撤销所有文件修改？共 ${changes.length} 个文件将被恢复。` })}
            className="text-[#666] hover:text-[#E61919] transition-colors"
          >
            [REVERT ALL]
          </button>
          <button
            onClick={handleAcceptAll}
            className="text-[#666] hover:text-[#4AF626] transition-colors"
          >
            [ACCEPT ALL]
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#222] max-h-[300px] overflow-y-auto">
          {changes.map((change) => (
            <div key={change.filePath} className="border-b border-[#222]">
              <div className="flex items-center gap-2 px-4 py-1.5 text-xs hover:bg-[#111] transition-colors">
                <span className={change.changeType === 'created' ? 'text-[#4AF626]' : 'text-yellow-400'}>
                  {change.changeType === 'created' ? '+' : '~'}
                </span>
                <span
                  onClick={() => setSelectedFile(selectedFile === change.filePath ? null : change.filePath)}
                  className="text-[#EAEAEA] truncate flex-1 text-left cursor-pointer"
                >
                  {change.filePath.split('/').slice(-2).join('/')}
                </span>
                <button
                  onClick={() => setConfirmState({ type: 'single', snapshotId: undefined, message: `撤销 ${change.filePath.split('/').pop()} 的所有修改？` })}
                  className="text-[10px] text-[#666] hover:text-[#E61919] uppercase tracking-[0.1em]"
                >
                  [REVERT]
                </button>
                <button
                  onClick={() => handleAcceptFile(change.filePath)}
                  className="text-[10px] text-[#666] hover:text-[#4AF626] uppercase tracking-[0.1em]"
                >
                  [ACCEPT]
                </button>
              </div>

              {selectedFile === change.filePath && history.length > 0 && (
                <div className="bg-[#0A0A0A] px-4 py-2 space-y-2">
                  {history.map((snap) => {
                    const added = snap.contentAfter.split('\n').length
                    const removed = snap.contentBefore ? snap.contentBefore.split('\n').length : 0
                    return (
                      <div key={snap.id} className="flex items-center justify-between text-[10px]">
                        <span className="text-[#666]">
                          Turn {snap.turnIndex} — <span className="text-[#4AF626]">+{added}L</span>{' '}
                          {removed > 0 && <span className="text-[#E61919]">-{removed}L</span>}
                        </span>
                        <button
                          onClick={() => setConfirmState({ type: 'single', snapshotId: snap.id, message: '撤销这次修改？文件将恢复到修改前的状态。' })}
                          className="text-[#666] hover:text-[#E61919] uppercase tracking-[0.1em]"
                        >
                          [REVERT]
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
